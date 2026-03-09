import { History } from './history.js';
import { Coder } from './coder.js';
import { VisionInterpreter } from './vision/vision_interpreter.js';
import { Prompter } from '../models/prompter.js';
import { initModes } from './modes.js';
import { initBot } from '../utils/mcdata.js';
import * as mc from '../utils/mcdata.js';
import { containsCommand, commandExists, executeCommand, truncCommandMessage, isAction, blacklistCommands, parseCommandMessage, getCommand } from './commands/index.js';
import { ActionManager } from './action_manager.js';
import { NPCContoller } from './npc/controller.js';
import { MemoryBank } from './memory_bank.js';
import { SelfPrompter } from './self_prompter.js';
import convoManager from './conversation.js';
import { handleTranslation, handleEnglishTranslation } from '../utils/translator.js';
import { addBrowserViewer } from './vision/browser_viewer.js';
import { serverProxy, sendOutputToServer } from './mindserver_proxy.js';
import settings from './settings.js';
import { Task } from './tasks/tasks.js';
import { speak } from './speak.js';
import { log, validateNameFormat, handleDisconnection } from './connection_handler.js';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { RecursiveTaskManager } from './tasks/recursive_task_manager.js';
import { DamageLogger } from './reflex/damage_logger.js';
import { ReflexArchitect } from './reflex/reflex_architect.js';
import { ReflexLoader } from './reflex/reflex_loader.js';
import * as skills from './library/skills.js';
import * as world from './library/world.js';

export class Agent {
    async start(load_mem = false, init_message = null, count_id = 0) {
        this.last_sender = null;
        this.count_id = count_id;
        this._disconnectHandled = false;
        this.request_seq = 0;
        this.current_request_id = null;
        this._handleMessageLock = Promise.resolve(); // async mutex for handleMessage

        // Initialize components
        this.actions = new ActionManager(this);
        this.prompter = new Prompter(this, settings.profile);
        this.name = (this.prompter.getName() || '').trim();
        console.log(`Initializing agent ${this.name}...`);

        // Validate Name Format
        // connection_handler now ensures the message has [LoginGuard] prefix
        const nameCheck = validateNameFormat(this.name);
        if (!nameCheck.success) {
            log(this.name, nameCheck.msg);
            process.exit(1);
            return;
        }

        this.history = new History(this);
        this.coder = new Coder(this);
        this.npc = new NPCContoller(this);
        this.memory_bank = new MemoryBank();
        this.memory_bank.initSpatialMemory(this.name);
        this.memory_bank.loadSpatialMemory();
        this.damage_logger = new DamageLogger(this);
        this.reflex_architect = new ReflexArchitect(this);
        this.reflex_loader = new ReflexLoader(this);
        this.self_prompter = new SelfPrompter(this);
        this.recursive_tasks = new RecursiveTaskManager(this);
        convoManager.initAgent(this);
        await this.prompter.initExamples();

        // load mem first before doing task
        let save_data = null;
        if (load_mem) {
            save_data = this.history.load();
        }
        let taskStart = null;
        if (save_data) {
            taskStart = save_data.taskStart;
        } else {
            taskStart = Date.now();
        }
        this.task = new Task(this, settings.task, taskStart);
        this.blocked_actions = settings.blocked_actions.concat(this.task.blocked_actions || []);
        blacklistCommands(this.blocked_actions);

        this._initConnection(save_data, load_mem, init_message, count_id);
    }

    _initConnection(save_data, load_mem, init_message, count_id) {
        console.log(this.name, 'logging into minecraft...');
        this.bot = initBot(this.name);
        this.bot.mindcraft_agent = this;

        // Connection Handler with Auto-Reconnect
        const onDisconnect = (event, reason) => {
            if (this._disconnectHandled) return;
            this._disconnectHandled = true;

            const { type, isFatal, msg } = handleDisconnection(this.name, reason);

            if (isFatal) {
                console.log(`[${this.name}] Fatal disconnect. Exiting...`);
                process.exit(1);
            } else {
                this.reconnect_attempts = (this.reconnect_attempts || 0) + 1;
                const backoff = Math.min(1000 * Math.pow(2, this.reconnect_attempts), 60000); // Max 1 min backoff
                console.log(`[${this.name}] Non-fatal disconnect. Reconnecting in ${backoff / 1000}s (Attempt ${this.reconnect_attempts})...`);

                // Cleanup previous instances before reconnecting
                if (this.bot) {
                    this.bot.removeAllListeners();
                }

                setTimeout(() => {
                    this._disconnectHandled = false;
                    this._initConnection(save_data, load_mem, init_message, count_id);
                }, backoff);
            }
        };

        // Bind events
        this.bot.once('kicked', (reason) => onDisconnect('Kicked', reason));
        this.bot.once('end', (reason) => onDisconnect('Disconnected', reason));
        this.bot.on('error', (err) => {
            if (String(err).includes('Duplicate') || String(err).includes('ECONNREFUSED')) {
                onDisconnect('Error', err);
            } else {
                log(this.name, `[LoginGuard] Connection Error: ${String(err)}`);
            }
        });

        initModes(this);

        this.bot.on('login', () => {
            console.log(this.name, 'logged in!');
            this.reconnect_attempts = 0; // Reset backoff on success
            serverProxy.login();

            // Set skin for profile
            if (this.prompter.profile.skin)
                this.bot.chat(`/skin set URL ${this.prompter.profile.skin.model} ${this.prompter.profile.skin.path}`);
            else
                this.bot.chat(`/skin clear`);
        });

        const spawnTimeoutDuration = settings.spawn_timeout;
        const spawnTimeout = setTimeout(() => {
            const msg = `Bot has not spawned after ${spawnTimeoutDuration} seconds. Exiting.`;
            log(this.name, msg);
            onDisconnect('SpawnTimeout', msg);
        }, spawnTimeoutDuration * 1000);

        this.bot.once('spawn', async () => {
            try {
                clearTimeout(spawnTimeout);
                addBrowserViewer(this.bot, count_id);
                console.log('Initializing vision intepreter...');
                this.vision_interpreter = new VisionInterpreter(this, settings.allow_vision);

                // wait for a bit so stats are not undefined
                await new Promise((resolve) => setTimeout(resolve, 1000));

                console.log(`${this.name} spawned.`);
                this.clearBotLogs();

                this._setupEventHandlers(save_data, init_message);
                this.startEvents();

                if (!load_mem) {
                    if (settings.task) {
                        this.task.initBotTask();
                        this.task.setAgentGoal();
                    }
                } else {
                    // set the goal without initializing the rest of the task
                    if (settings.task) {
                        this.task.setAgentGoal();
                    }
                }

                await new Promise((resolve) => setTimeout(resolve, 10000));
                this.checkAllPlayersPresent();

            } catch (error) {
                console.error('Error in spawn event:', error);
                onDisconnect('SpawnError', error);
            }
        });
    }

    async _setupEventHandlers(save_data, init_message) {
        const ignore_messages = [
            "Set own game mode to",
            "Set the time to",
            "Set the difficulty to",
            "Teleported ",
            "Set the weather to",
            "Gamerule "
        ];

        const respondFunc = async (username, message) => {
            if (message === "") return;
            if (username === this.name) return;
            if (settings.only_chat_with.length > 0 && !settings.only_chat_with.includes(username)) return;
            try {
                if (ignore_messages.some((m) => message.startsWith(m))) return;

                this.shut_up = false;

                console.log(this.name, 'received message from', username, ':', message);

                if (convoManager.isOtherAgent(username)) {
                    console.warn('received whisper from other bot??')
                }
                else {
                    this.handleMessage(username, message);
                }
            } catch (error) {
                console.error('Error handling message:', error);
            }
        }

        this.respondFunc = respondFunc;

        this.bot.on('whisper', respondFunc);

        this.bot.on('chat', (username, message) => {
            if (serverProxy.getNumOtherAgents() > 0) return;
            // only respond to open chat messages when there are no other agents
            respondFunc(username, message);
        });

        // Set up auto-eat
        this.bot.autoEat.options = {
            priority: 'foodPoints',
            startAt: 14,
            bannedFood: ["rotten_flesh", "spider_eye", "poisonous_potato", "pufferfish", "chicken"]
        };

        if (save_data?.self_prompt) {
            if (init_message) {
                this.history.add('system', init_message);
            }
            await this.self_prompter.handleLoad(save_data.self_prompt, save_data.self_prompting_state);
        }
        if (save_data?.last_sender) {
            this.last_sender = save_data.last_sender;
            if (convoManager.otherAgentInGame(this.last_sender)) {
                const msg_package = {
                    message: `You have restarted and this message is auto-generated. Continue the conversation with me.`,
                    start: true
                };
                convoManager.receiveFromBot(this.last_sender, msg_package);
            }
        }
        else if (init_message) {
            await this.handleMessage('system', init_message, 2);
        }
        else {
            this.openChat("Hello world! I am " + this.name);
        }
    }

    checkAllPlayersPresent() {
        if (!this.task || !this.task.agent_names) {
            return;
        }

        const missingPlayers = this.task.agent_names.filter(name => !this.bot.players[name]);
        if (missingPlayers.length > 0) {
            console.log(`Missing players/bots: ${missingPlayers.join(', ')}`);
            this.cleanKill('Not all required players/bots are present in the world. Exiting.', 4);
        }
    }

    requestInterrupt() {
        this.bot.interrupt_code = true;
        this.bot.stopDigging();
        this.bot.collectBlock.cancelTask();
        this.bot.pathfinder.stop();
        this.bot.pvp.stop();
    }

    clearBotLogs() {
        this.bot.output = '';
        this.bot.interrupt_code = false;
    }

    shutUp() {
        this.shut_up = true;
        if (this.self_prompter.isActive()) {
            this.self_prompter.stop(false);
        }
        convoManager.endAllConversations();
    }

    _nextRequestId(source = 'unknown') {
        this.request_seq += 1;
        const safeSource = String(source || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
        return `${this.name || 'agent'}-${Date.now()}-${this.request_seq}-${safeSource}`;
    }

    _inferErrorCode(message) {
        const text = String(message || '').toLowerCase();
        if (!text) return 'none';
        if (text.includes('timed out') || text.includes('timeout')) return 'timeout';
        if (text.includes('interrupt')) return 'interrupted';
        if (text.includes('not a bot')) return 'invalid_input';
        if (
            (text.includes('was given') && text.includes('args') && text.includes('requires')) ||
            text.includes('missing required param') ||
            text.includes('must be of type')
        ) return 'invalid_input';
        if (text.includes('not enough') || text.includes('dont have') || text.includes("don't have")) return 'missing_resource';
        if (text.includes('cannot') || text.includes("can't") || text.includes('unable to')) return 'execution_failed';
        if (text.includes('invalid') || text.includes('does not exist') || text.includes('incorrectly formatted')) return 'invalid_input';
        if (text.includes('could not find') || (text.includes('no ') && text.includes('nearby'))) return 'not_found';
        if (text.includes('failed') || text.includes('error') || text.includes('exception')) return 'execution_failed';
        return 'none';
    }

    _normalizeCommandResult(commandName, executeRes, requestId, source = 'command') {
        if (executeRes && typeof executeRes === 'object' && executeRes.schema_version === 'v1') {
            const telemetry = executeRes.telemetry && typeof executeRes.telemetry === 'object'
                ? { ...executeRes.telemetry }
                : {};
            if (requestId && !telemetry.request_id) {
                telemetry.request_id = requestId;
            }
            if (!telemetry.command_name && commandName) {
                telemetry.command_name = commandName;
            }
            if (!telemetry.source) {
                telemetry.source = source;
            }
            return {
                ...executeRes,
                telemetry
            };
        }
        const message = executeRes == null ? '' : String(executeRes);
        const errorCode = this._inferErrorCode(message);
        const success = errorCode === 'none';
        return {
            schema_version: 'v1',
            success,
            error_code: errorCode,
            reason: success
                ? `Command "${commandName}" executed successfully.`
                : `Command "${commandName}" returned error code "${errorCode}".`,
            telemetry: {
                request_id: requestId || null,
                source,
                command_name: commandName || null,
                output_chars: message.length,
                timestamp: new Date().toISOString()
            },
            message
        };
    }

    _escapeCommandString(value, maxLen = 220) {
        let text = (value || '').toString().replaceAll('\n', ' ').replaceAll('\r', ' ').replace(/\s+/g, ' ').trim();
        if (text.length > maxLen) {
            text = text.slice(0, maxLen);
        }
        return text.replaceAll('"', "'");
    }

    async _executeCommandWithSchema(commandText, requestId, source = 'command') {
        const parsed = parseCommandMessage(commandText);
        const commandName = typeof parsed === 'string'
            ? (containsCommand(commandText) || 'unknown')
            : parsed.commandName;
        const executeRes = await executeCommand(this, commandText);
        return this._normalizeCommandResult(commandName, executeRes, requestId, source);
    }

    async acquireResourceLock(resourceKey, options = {}) {
        const lockResult = await serverProxy.acquireResourceLock(resourceKey, options);
        if (lockResult.acquired) {
            console.log(`[ResourceLock] acquired ${resourceKey} token=${lockResult.token}`);
        } else {
            console.warn(`[ResourceLock] failed to acquire ${resourceKey}: ${lockResult.message || 'unknown'}`);
        }
        return lockResult;
    }

    async releaseResourceLock(resourceKey, token = null) {
        const releaseResult = await serverProxy.releaseResourceLock(resourceKey, token);
        if (!releaseResult.released) {
            console.warn(`[ResourceLock] release ${resourceKey} failed: ${releaseResult.message || 'unknown'}`);
        }
        return releaseResult;
    }

    _routeIntentToCommand(rawMessage) {
        const message = (rawMessage || '').toString().trim();
        if (!message || containsCommand(message)) {
            return null;
        }
        const lower = message.toLowerCase();

        const broadMissionKeywords = ['sinh tồn', 'sinh ton', 'pha dao', 'phá đảo', 'beat the game', 'ender dragon', 'kill dragon', 'giết rồng', 'kill the dragon', 'speedrun'];
        const missionHint = broadMissionKeywords.some(keyword => lower.includes(keyword));
        if (missionHint) {
            const mission = this._escapeCommandString(message);
            return {
                command: `!startLongTermGoal("${mission}")`,
                reason: 'broad_mission_intent'
            };
        }

        const simpleIntents = [
            { patterns: ['stats', 'status', 'trang thai', 'thong so'], command: '!stats', reason: 'status_intent' },
            { patterns: ['inventory', 'tui do', 'kho do'], command: '!inventory', reason: 'inventory_intent' },
            { patterns: ['help', 'commands', 'lenh'], command: '!help', reason: 'help_intent' },
            { patterns: ['stop', 'dung lai', 'dung bot'], command: '!stop', reason: 'stop_intent' },
            { patterns: ['im lang', 'stfu'], command: '!stfu', reason: 'silence_intent' },
            { patterns: ['goal status', 'long term status', 'nhiem vu dai han'], command: '!longTermGoalStatus', reason: 'long_term_status_intent' }
        ];
        for (const intent of simpleIntents) {
            if (intent.patterns.some(pattern => lower.includes(pattern))) {
                return { command: intent.command, reason: intent.reason };
            }
        }

        const coordMatch = lower.match(/x\s*[:=]?\s*(-?\d+(?:\.\d+)?)\D+y\s*[:=]?\s*(-?\d+(?:\.\d+)?)\D+z\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i);
        if (coordMatch) {
            const x = Number.parseFloat(coordMatch[1]);
            const y = Number.parseFloat(coordMatch[2]);
            const z = Number.parseFloat(coordMatch[3]);
            const command = `!goToCoordinates(${x}, ${y}, ${z}, 1)`;
            return { command, reason: 'coordinate_navigation_intent' };
        }

        const collectMatch = lower.match(/\b(collect|gather|get|mine|harvest|thu thap|lay|dao)\b\s+(\d+)\s+([a-z0-9_ ]{2,50})/i);
        if (collectMatch) {
            const quantity = Number.parseInt(collectMatch[2], 10);
            const itemName = this._normalizeTaskItemName(collectMatch[3]);
            if (itemName && Number.isFinite(quantity) && quantity > 0 && mc.getBlockId(itemName) != null) {
                return {
                    command: `!collectBlocks("${itemName}", ${quantity})`,
                    reason: 'collect_intent'
                };
            }
        }

        const craftMatch = lower.match(/\b(craft|make|che)\b\s+(\d+)\s+([a-z0-9_ ]{2,50})/i);
        if (craftMatch) {
            const quantity = Number.parseInt(craftMatch[2], 10);
            const itemName = this._normalizeTaskItemName(craftMatch[3]);
            if (itemName && Number.isFinite(quantity) && quantity > 0 && mc.getItemId(itemName) != null) {
                return {
                    command: `!craftRecipe("${itemName}", ${quantity})`,
                    reason: 'craft_intent'
                };
            }
        }

        const smeltMatch = lower.match(/\b(smelt|nung)\b\s+(\d+)\s+([a-z0-9_ ]{2,50})/i);
        if (smeltMatch) {
            const quantity = Number.parseInt(smeltMatch[2], 10);
            const itemName = this._normalizeTaskItemName(smeltMatch[3]);
            if (itemName && Number.isFinite(quantity) && quantity > 0 && mc.getItemId(itemName) != null) {
                return {
                    command: `!smeltItem("${itemName}", ${quantity})`,
                    reason: 'smelt_intent'
                };
            }
        }

        return null;
    }

    async handleMessage(source, message, max_responses = null) {
        // Serialize concurrent handleMessage calls via async mutex
        let releaseLock;
        const lockPromise = new Promise(resolve => { releaseLock = resolve; });
        const prevLock = this._handleMessageLock;
        this._handleMessageLock = lockPromise;
        await prevLock;

        const prevRequestId = this.current_request_id;
        const requestId = this._nextRequestId(source);
        this.current_request_id = requestId;
        try {
            await this.checkTaskDone();
            if (!source || !message) {
                console.warn('Received empty message from', source);
                return false;
            }

            let used_command = false;
            if (max_responses === null) {
                max_responses = settings.max_commands === -1 ? Infinity : settings.max_commands;
            }
            if (max_responses === -1) {
                max_responses = Infinity;
            }

            const self_prompt = source === 'system' || source === this.name;
            const from_other_bot = convoManager.isOtherAgent(source);

            if (!self_prompt && !from_other_bot) { // from user, route command/intent before LLM
                const user_command_name = containsCommand(message);
                if (user_command_name) {
                    if (!commandExists(user_command_name)) {
                        this.routeResponse(source, `Command '${user_command_name}' does not exist.`);
                        return false;
                    }
                    this.routeResponse(source, `*${source} used ${user_command_name.substring(1)}*`);
                    if (user_command_name === '!newAction') {
                        // all user-initiated commands are ignored by the bot except for this one
                        // add the preceding message to the history to give context for newAction
                        this.history.add(source, message);
                    }
                    const commandResult = await this._executeCommandWithSchema(message, requestId, 'user_command');
                    if (commandResult.message) {
                        this.routeResponse(source, commandResult.message);
                    } else if (!commandResult.success && commandResult.reason) {
                        this.routeResponse(source, commandResult.reason);
                    }
                    return true;
                }

                const routedIntent = this._routeIntentToCommand(message);
                if (routedIntent && routedIntent.command) {
                    const parsedIntent = parseCommandMessage(routedIntent.command);
                    if (typeof parsedIntent !== 'string' && commandExists(parsedIntent.commandName)) {
                        this.routeResponse(source, `*auto-routed request to ${parsedIntent.commandName.substring(1)}*`);
                        const commandResult = await this._executeCommandWithSchema(
                            routedIntent.command,
                            requestId,
                            `intent_router:${routedIntent.reason || 'matched'}`
                        );
                        if (commandResult.message) {
                            this.routeResponse(source, commandResult.message);
                        } else if (!commandResult.success && commandResult.reason) {
                            this.routeResponse(source, commandResult.reason);
                        }
                        await this.history.add('system', `Intent router matched "${routedIntent.reason || 'unknown'}" -> ${routedIntent.command}`);
                        return true;
                    }
                }
            }

            if (from_other_bot)
                this.last_sender = source;

            // Now translate the message
            message = await handleEnglishTranslation(message);
            console.log(`[request:${requestId}] received message from`, source, ':', message);

            const checkInterrupt = () => this.self_prompter.shouldInterrupt(self_prompt) || this.shut_up || convoManager.responseScheduledFor(source);

            let behavior_log = this.bot.modes.flushBehaviorLog().trim();
            if (behavior_log.length > 0) {
                const MAX_LOG = 500;
                if (behavior_log.length > MAX_LOG) {
                    behavior_log = '...' + behavior_log.substring(behavior_log.length - MAX_LOG);
                }
                behavior_log = 'Recent behaviors log: \n' + behavior_log;
                await this.history.add('system', behavior_log);
            }

            // Handle other user messages
            await this.history.add(source, message);
            this.history.save();

            if (!self_prompt && this.self_prompter.isActive()) // message is from user during self-prompting
                max_responses = 1; // force only respond to this message, then let self-prompting take over
            for (let i = 0; i < max_responses; i++) {
                if (checkInterrupt()) break;
                let history = this.history.getHistory();
                let res = await this.prompter.promptConvo(history);

                console.log(`${this.name} full response to ${source}: ""${res}""`);

                if (res.trim().length === 0) {
                    console.warn('no response')
                    break; // empty response ends loop
                }

                let command_name = containsCommand(res);

                if (command_name) { // contains query or command
                    res = truncCommandMessage(res); // everything after the command is ignored
                    this.history.add(this.name, res);

                    if (!commandExists(command_name)) {
                        this.history.add('system', `Command ${command_name} does not exist. Did you mean !craftRecipe? Please safely check the COMMAND DOCS strictly and try the correct command. Do not hallucinate commands.`);
                        console.warn('Agent hallucinated command:', command_name)
                        continue;
                    }

                    if (checkInterrupt()) break;
                    this.self_prompter.handleUserPromptedCmd(self_prompt, isAction(command_name));

                    if (settings.show_command_syntax === "full") {
                        this.routeResponse(source, res);
                    }
                    else if (settings.show_command_syntax === "shortened") {
                        // show only "used !commandname"
                        let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                        let chat_message = `*used ${command_name.substring(1)}*`;
                        if (pre_message.length > 0)
                            chat_message = `${pre_message}  ${chat_message}`;
                        this.routeResponse(source, chat_message);
                    }
                    else {
                        // no command at all
                        let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                        if (pre_message.trim().length > 0)
                            this.routeResponse(source, pre_message);
                    }

                    const commandResult = await this._executeCommandWithSchema(res, requestId, 'llm_command');

                    console.log('Agent executed:', command_name, 'and got:', commandResult);
                    used_command = true;

                    if (commandResult.message) {
                        if (commandResult.success) {
                            this.history.add('system', commandResult.message);
                        } else {
                            this.history.add('system', `Command failed (${commandResult.error_code}): ${commandResult.reason}\n${commandResult.message}`);
                        }
                    } else if (!commandResult.success && commandResult.reason)
                        this.history.add('system', commandResult.reason);
                    else
                        break;
                }
                else { // conversation response
                    this.history.add(this.name, res);
                    this.routeResponse(source, res);
                    break;
                }

                this.history.save();
            }

            return used_command;
        } finally {
            this.current_request_id = prevRequestId;
            releaseLock(); // release async mutex
        }
    }

    async routeResponse(to_player, message) {
        if (this.shut_up) return;
        let self_prompt = to_player === 'system' || to_player === this.name;
        if (self_prompt && this.last_sender) {
            // this is for when the agent is prompted by system while still in conversation
            // so it can respond to events like death but be routed back to the last sender
            to_player = this.last_sender;
        }

        if (convoManager.isOtherAgent(to_player) && convoManager.inConversation(to_player)) {
            // if we're in an ongoing conversation with the other bot, send the response to it
            convoManager.sendToBot(to_player, message);
        }
        else {
            // otherwise, use open chat
            this.openChat(message);
            // note that to_player could be another bot, but if we get here the conversation has ended
        }
    }

    async openChat(message) {
        let to_translate = message;
        let remaining = '';
        let command_name = containsCommand(message);
        let translate_up_to = command_name ? message.indexOf(command_name) : -1;
        if (translate_up_to != -1) { // don't translate the command
            to_translate = to_translate.substring(0, translate_up_to);
            remaining = message.substring(translate_up_to);
        }
        message = (await handleTranslation(to_translate)).trim() + " " + remaining;
        // newlines are interpreted as separate chats, which triggers spam filters. replace them with spaces
        message = message.replaceAll('\n', ' ');

        if (settings.only_chat_with.length > 0) {
            for (let username of settings.only_chat_with) {
                this.bot.whisper(username, message);
            }
        }
        else {
            if (settings.speak) {
                speak(to_translate, this.prompter.profile.speak_model);
            }
            if (settings.chat_ingame) { this.bot.chat(message); }
            sendOutputToServer(this.name, message);
        }
    }

    startEvents() {
        // Custom events
        this.bot.on('time', () => {
            try {
                if (this.bot.time.timeOfDay == 0)
                    this.bot.emit('sunrise');
                else if (this.bot.time.timeOfDay == 6000)
                    this.bot.emit('noon');
                else if (this.bot.time.timeOfDay == 12000)
                    this.bot.emit('sunset');
                else if (this.bot.time.timeOfDay == 18000)
                    this.bot.emit('midnight');
            } catch (err) {
                console.error('[EventBoundary] time handler error:', err.message);
            }
        });

        let prev_health = this.bot.health;
        this.bot.lastDamageTime = 0;
        this.bot.lastDamageTaken = 0;
        // Single unified health listener — replaces duplicate listeners in DamageLogger and ReflexLoader
        this.bot.on('health', () => {
            try {
                if (this.bot.health < prev_health) {
                    const amount = prev_health - this.bot.health;
                    this.bot.lastDamageTime = Date.now();
                    this.bot.lastDamageTaken = amount;
                    // Forward to DamageLogger (recording)
                    this.damage_logger.recordDamageEvent(amount);
                    // Forward to ReflexLoader (reaction)
                    const recentLogs = this.damage_logger.getRecentLogs();
                    const attackerName = recentLogs.length > 0 ? recentLogs[0].attacker : 'unknown';
                    this.reflex_loader._triggerReflex(attackerName, amount);
                    // Auto-learn new reflexes when enough damage has been accumulated
                    if (this.damage_logger.readyToLearn) {
                        this.reflex_architect.learnFromDamage();
                    }
                }
                prev_health = this.bot.health;
            } catch (err) {
                console.error('[EventBoundary] health handler error:', err.message);
            }
        });
        // Logging callbacks
        this.bot.on('error', (err) => {
            console.error('Error event!', err);
        });
        // NOTE: 'end' event is handled by _initConnection() with auto-reconnect logic.
        // Do not register a second 'end' handler here that calls cleanKill/process.exit.
        this.bot.on('death', () => {
            try {
                this.actions.cancelResume();
                this.actions.stop();
                // Reset stuck in_progress task tree nodes after death
                if (this.recursive_tasks) {
                    this.recursive_tasks.resetOnDeath();
                }
            } catch (err) {
                console.error('[EventBoundary] death handler error:', err.message);
            }
        });
        this.bot.on('kicked', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        this.bot.on('messagestr', async (message, _, jsonMsg) => {
            if (jsonMsg.translate && jsonMsg.translate.startsWith('death') && message.startsWith(this.name)) {
                console.log('Agent died: ', message);
                let death_pos = this.bot.entity.position;
                this.memory_bank.rememberPlace('last_death_position', death_pos.x, death_pos.y, death_pos.z);
                let death_pos_text = null;
                if (death_pos) {
                    death_pos_text = `x: ${death_pos.x.toFixed(2)}, y: ${death_pos.y.toFixed(2)}, z: ${death_pos.z.toFixed(2)}`;
                }
                let dimention = this.bot.game.dimension;

                // Get Death Replay from Damage Logger
                const deathReplay = this.damage_logger.getDeathReplay();

                this.handleMessage('system', `You died at position ${death_pos_text || "unknown"} in the ${dimention} dimension with the final message: '${message}'.\n${deathReplay}\nYour place of death is saved as 'last_death_position' if you want to return. Previous actions were stopped and you have respawned. If you need to survive this in the future, consider using !newAction to teach yourself a defensive or survival skill.`);
            }
        });
        this.bot.on('idle', () => {
            try {
                this.bot.clearControlStates();
                this.bot.pathfinder.stop(); // clear any lingering pathfinder
                this.bot.modes.unPauseAll();
                // removed setTimeout call - moved to update loop for active polling
            } catch (err) {
                console.error('[EventBoundary] idle handler error:', err.message);
            }
        });

        // Spatial Memory: auto-remember valuable blocks near bot
        const VALUABLE_BLOCKS = new Set([
            'diamond_ore', 'deepslate_diamond_ore',
            'iron_ore', 'deepslate_iron_ore',
            'gold_ore', 'deepslate_gold_ore',
            'emerald_ore', 'deepslate_emerald_ore',
            'ancient_debris',
            'chest', 'crafting_table', 'furnace', 'blast_furnace', 'smoker',
            'enchanting_table', 'anvil', 'brewing_stand'
        ]);
        // B6: Task Interrupt configurations
        const INTERRUPT_BLOCKS = new Set(['diamond_ore', 'deepslate_diamond_ore', 'emerald_ore', 'deepslate_emerald_ore', 'ancient_debris']);
        let lastInterruptTime = 0;

        let lastSpatialScanPos = null;
        this.bot.on('move', () => {
            try {
                const pos = this.bot.entity.position;
                // Only scan every 8 blocks moved to avoid lag
                if (lastSpatialScanPos) {
                    const dx = pos.x - lastSpatialScanPos.x;
                    const dz = pos.z - lastSpatialScanPos.z;
                    if (dx * dx + dz * dz < 64) return; // 8^2
                }
                lastSpatialScanPos = pos.clone();
                // Scan nearby blocks for valuable ones
                const scanRadius = 8;
                for (let x = -scanRadius; x <= scanRadius; x++) {
                    for (let y = -scanRadius; y <= scanRadius; y++) {
                        for (let z = -scanRadius; z <= scanRadius; z++) {
                            if (this.bot.interrupt_code) return;
                            const block = this.bot.blockAt(pos.offset(x, y, z));
                            if (block && VALUABLE_BLOCKS.has(block.name)) {
                                this.memory_bank.rememberBlock(block.name, block.position.x, block.position.y, block.position.z, this.bot.game.dimension);

                                // B6: Opportunity Detector
                                if (INTERRUPT_BLOCKS.has(block.name)) {
                                    const dist = pos.distanceTo(block.position);
                                    if (dist <= 5 && Date.now() - lastInterruptTime > 60000 && this.recursive_task_manager && this.recursive_task_manager.isRunning) {
                                        lastInterruptTime = Date.now();
                                        console.log(`[OpportunityDetector] Spotted ${block.name} nearby! Triggering interrupt.`);
                                        this.handleMessage('system', `I spotted a ${block.name} at x=${block.position.x}, y=${block.position.y}, z=${block.position.z} nearby! I should grab it before continuing my current task.`);
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                // Silently ignore — spatial scan is best-effort
            }
        });

        // Spatial Memory: invalidate when blocks are broken
        this.bot.on('blockUpdate', (oldBlock, newBlock) => {
            try {
                if (newBlock && newBlock.name === 'air' && oldBlock && oldBlock.name !== 'air') {
                    const bPos = newBlock.position;
                    if (bPos) {
                        this.memory_bank.forgetBlock(bPos.x, bPos.y, bPos.z, this.bot.game.dimension);
                    }
                }
            } catch (err) {
                // Silently ignore — invalidation is best-effort
            }
        });

        // B4: Auto-save spatial memory every 5 minutes to prevent data loss on crash
        setInterval(() => {
            try {
                this.memory_bank.enforceLimits();
                this.memory_bank.saveSpatialMemory();
            } catch (err) {
                console.error('Auto-save spatial memory failed:', err.message);
            }
        }, 5 * 60 * 1000);

        // B7: Emotion State Machine compute
        setInterval(() => {
            try {
                this._computeConfidence();
            } catch (err) {
                console.error('Emotion state machine failed:', err.message);
            }
        }, 30000);

        // Init NPC controller
        this.npc.init();

        // This update loop ensures that each update() is called one at a time, even if it takes longer than the interval
        const INTERVAL = 300;
        let last = Date.now();
        setTimeout(async () => {
            while (true) {
                let start = Date.now();
                try {
                    await this.update(start - last);
                } catch (err) {
                    console.error('Error in agent update loop:', err);
                }
                let remaining = INTERVAL - (Date.now() - start);
                if (remaining > 0) {
                    await new Promise((resolve) => setTimeout(resolve, remaining));
                }
                last = start;
            }
        }, INTERVAL);

        // Init damage logger and reflex loader since bot is ready
        this.damage_logger.startListening();
        this.reflex_loader.loadReflexes();

        this.bot.emit('idle');
    }

    async update(delta) {
        await this.bot.modes.update();

        // Priority 1: Mission Execution (Active Loop)
        // If a mission is running, it suppresses autonomous self-prompting to maintain focus.
        if (this.recursive_tasks && this.recursive_tasks.isRunning && !this.recursive_tasks.isPaused) {
            await this.maybeRunLongTermGoal('update');
        } else {
            // Priority 2: Self-Prompting (Autonomous Mode)
            this.self_prompter.update(delta);
        }

        await this.checkTaskDone();
    }

    isIdle() {
        return !this.actions.executing;
    }

    _normalizeTaskItemName(rawName) {
        if (!rawName) {
            return null;
        }
        let cleaned = rawName
            .toString()
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_ ]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replaceAll(' ', '_');
        if (!cleaned) {
            return null;
        }

        const candidates = new Set([cleaned]);
        if (cleaned.endsWith('_logs')) candidates.add(cleaned.replace(/_logs$/, '_log'));
        if (cleaned.endsWith('_ingots')) candidates.add(cleaned.replace(/_ingots$/, '_ingot'));
        if (cleaned.endsWith('_ores')) candidates.add(cleaned.replace(/_ores$/, '_ore'));
        if (cleaned.endsWith('s')) candidates.add(cleaned.slice(0, -1));
        if (cleaned.endsWith('es')) candidates.add(cleaned.slice(0, -2));

        for (const candidate of candidates) {
            try {
                if (mc.getItemId(candidate) != null || mc.getBlockId(candidate) != null) {
                    return candidate;
                }
            } catch (_err) {
                return null;
            }
        }
        return null;
    }

    _extractTaskIntent(taskDesc) {
        const desc = (taskDesc || '').toString().trim();
        if (!desc) {
            return null;
        }

        const patterns = [
            { type: 'collect', regex: /\b(collect|gather|obtain|get|mine|harvest)\b\s+(\d+)\s+([a-z0-9_ ]{2,50})/i },
            { type: 'craft', regex: /\b(craft|make)\b\s+(\d+)\s+([a-z0-9_ ]{2,50})/i },
            { type: 'smelt', regex: /\b(smelt)\b\s+(\d+)\s+([a-z0-9_ ]{2,50})/i },
            { type: 'place', regex: /\b(place|build)\b\s+(\d+)\s+([a-z0-9_ ]{2,50})/i }
        ];

        for (const pattern of patterns) {
            const match = desc.match(pattern.regex);
            if (!match) {
                continue;
            }
            const quantity = Number.parseInt(match[2], 10);
            if (!Number.isFinite(quantity) || quantity <= 0) {
                continue;
            }
            const itemName = this._normalizeTaskItemName(match[3]);
            if (!itemName) {
                continue;
            }
            return {
                type: pattern.type,
                quantity,
                itemName
            };
        }

        const xyzPattern = /x[:=\s]+(-?\d+(?:\.\d+)?)[,\s]+y[:=\s]+(-?\d+(?:\.\d+)?)[,\s]+z[:=\s]+(-?\d+(?:\.\d+)?)/i;
        const xyzMatch = desc.match(xyzPattern);
        if (xyzMatch) {
            return {
                type: 'goto',
                position: {
                    x: Number.parseFloat(xyzMatch[1]),
                    y: Number.parseFloat(xyzMatch[2]),
                    z: Number.parseFloat(xyzMatch[3])
                }
            };
        }

        return null;
    }

    _deterministicTaskCheck(task) {
        if (!task || !task.desc) {
            return { certain: false, done: false, reason: 'No task description.' };
        }

        const intent = this._extractTaskIntent(task.desc);
        if (!intent) {
            return { certain: false, done: false, reason: 'No deterministic pattern matched.' };
        }

        if (intent.type === 'goto') {
            const pos = this.bot?.entity?.position;
            if (!pos) {
                return { certain: false, done: false, reason: 'Bot position unavailable.' };
            }
            const dist = pos.distanceTo(intent.position);
            return {
                certain: true,
                done: dist <= 3,
                reason: dist <= 3
                    ? `Reached destination (distance ${dist.toFixed(2)}).`
                    : `Not at destination yet (distance ${dist.toFixed(2)}).`
            };
        }

        const inventory = world.getInventoryCounts(this.bot);
        const count = inventory[intent.itemName] || 0;
        if (intent.type === 'collect' || intent.type === 'craft' || intent.type === 'smelt') {
            return {
                certain: true,
                done: count >= intent.quantity,
                reason: `${intent.itemName}: ${count}/${intent.quantity} in inventory.`
            };
        }

        if (intent.type === 'place') {
            const nearby = world.getNearestBlocks(this.bot, intent.itemName, 10, intent.quantity);
            const placed = nearby.length;
            return {
                certain: true,
                done: placed >= intent.quantity,
                reason: `${intent.itemName} blocks nearby: ${placed}/${intent.quantity}.`
            };
        }

        return { certain: false, done: false, reason: 'Unsupported intent type.' };
    }

    _deriveFallbackTasks(task, failureReason = '') {
        const desc = (task?.desc || '').toLowerCase();
        const reason = (failureReason || '').toLowerCase();
        const fallback = [];

        const mentionsWood = desc.includes('wood') || desc.includes('log') || desc.includes('tree');
        const mentionsStoneOrOre = desc.includes('stone') || desc.includes('ore') || desc.includes('iron') || desc.includes('gold') || desc.includes('diamond') || desc.includes('deepslate');
        const missingTool = reason.includes('tool') || reason.includes('harvest') || reason.includes('pickaxe') || reason.includes('axe');
        const cannotFind = reason.includes('no ') && reason.includes('nearby') || reason.includes('could not find');
        const smeltBlocked = reason.includes('smelt') && (reason.includes('fuel') || reason.includes('no fuel'));
        const inventoryFull = reason.includes('inventory full');

        if (missingTool && mentionsStoneOrOre) {
            fallback.push('Collect 20 cobblestone');
            fallback.push('Craft 2 stone_pickaxe');
        } else if (missingTool && mentionsWood) {
            fallback.push('Collect 8 oak_log');
            fallback.push('Craft 1 wooden_axe');
        } else if (missingTool) {
            fallback.push('Craft 1 stone_pickaxe');
        }

        if (smeltBlocked) {
            fallback.push('Collect 16 coal');
        }
        if (cannotFind) {
            fallback.push(`Explore nearby area to locate resources for task: ${task.desc}`);
        }
        if (inventoryFull) {
            fallback.push('Put excess items into nearest chest to free inventory space');
        }
        return fallback.slice(0, 3);
    }

    _assessSafetyThreats() {
        const threats = [];
        if (!this.bot || !this.bot.entity) {
            return threats;
        }

        if (this.bot.health <= 8) {
            threats.push('low_health');
        }
        if (this.bot.food <= 7) {
            threats.push('low_hunger');
        }
        const hostile = world.getNearestEntityWhere(this.bot, entity => mc.isHostile(entity), 10);
        if (hostile) {
            threats.push(`hostile:${hostile.name}`);
        }
        return threats;
    }

    async _runSafetyManagerIfNeeded() {
        const threats = this._assessSafetyThreats();
        if (threats.length === 0) {
            return false;
        }

        const hasHostileThreat = threats.some(threat => threat.startsWith('hostile:'));
        const hasLowHealthThreat = threats.includes('low_health');
        const hasLowHungerThreat = threats.includes('low_hunger');

        await this.actions.runAction('safety:stabilize', async () => {
            if (hasHostileThreat) {
                await skills.defendSelf(this.bot, 10);
            }
            if (hasLowHealthThreat && hasHostileThreat) {
                await skills.avoidEnemies(this.bot, 18);
            }
            if (hasLowHungerThreat) {
                const edibleItem = this.bot.inventory.items().find(item => {
                    const fp = mc.getFoodPoints(item.name);
                    return fp != null && fp > 0;
                });
                if (edibleItem) {
                    await skills.consume(this.bot, edibleItem.name);
                }
            }
        }, { timeout: 2, forceInterrupt: true });
        return true;
    }

    _computeConfidence() {
        if (!this.bot || !this.bot.inventory) {
            this.confidenceLevel = 0.5;
            return;
        }

        const health = this.bot.health || 20;

        let hasWeapon = false;
        let hasArmor = false;
        const items = this.bot.inventory.items();
        for (const item of items) {
            if (item.name.includes('sword') || item.name.includes('axe') || item.name.includes('trident')) hasWeapon = true;
            if (item.name.includes('helmet') || item.name.includes('chestplate') || item.name.includes('leggings') || item.name.includes('boots')) hasArmor = true;
        }

        const deaths_recent = this.damage_logger.logs.filter(l => l.fatal && Date.now() - Date.parse(l.timestamp) < 600000).length;
        const kills_recent = this.damage_logger.getRecentKills();

        let confidence = (health / 20) * 0.3 +
            (hasWeapon ? 0.15 : 0) +
            (hasArmor ? 0.15 : 0) +
            (kills_recent * 0.05) -
            (deaths_recent * 0.2);

        this.confidenceLevel = Math.max(0, Math.min(1, confidence));
    }

    getDebugStateReport() {
        const bot = this.bot;
        const actionLabel = this.actions.currentActionLabel || 'Idle';
        const resumeLabel = this.actions.resume_name || 'None';
        const interrupts = bot.interrupt_code ? 'true' : 'false';
        const safetyThreats = this._assessSafetyThreats();
        const confidence = (this.confidenceLevel !== undefined ? this.confidenceLevel : 0.5).toFixed(2);

        const context = {
            inventory_counts: world.getInventoryCounts(bot),
            dimension: bot?.game?.dimension || null,
            biome: (() => {
                try {
                    return world.getBiomeName(bot);
                } catch (_err) {
                    return null;
                }
            })()
        };
        const recommendedActions = this.coder.getLearnedActionRecommendations(context, 5);

        const lines = [];
        lines.push(`Action: ${actionLabel}`);
        lines.push(`Resume Queue: ${resumeLabel}`);
        lines.push(`Interrupt Flag: ${interrupts}`);
        lines.push(`Recursive Mission Status: ${this.recursive_tasks.getMissionStatus()}`);
        lines.push(`Safety Threats: ${safetyThreats.length > 0 ? safetyThreats.join(', ') : 'none'}`);
        lines.push(`Mode Snapshot: ${bot.modes.getMiniDocs().replaceAll('\n', ' | ')}`);
        if (recommendedActions.length > 0) {
            lines.push('Top Learned Actions:');
            for (const action of recommendedActions) {
                lines.push(`- ${action.name} (${action.score.toFixed(2)})`);
            }
        } else {
            lines.push('Top Learned Actions: none');
        }
        return lines.join('\n');
    }

    async runSkillSmokeHarness() {
        const results = [];
        const record = (name, ok, detail = '') => {
            const status = ok ? 'PASS' : 'FAIL';
            results.push(`${status} ${name}${detail ? ` - ${detail}` : ''}`);
            return ok;
        };

        const requiredSkills = ['goToPosition', 'placeBlock', 'breakBlockAt', 'craftRecipe', 'collectBlock'];
        for (const skillName of requiredSkills) {
            const exists = typeof skills[skillName] === 'function';
            record(`skill export ${skillName}`, exists);
        }

        const requiredWorldFns = ['saveAction', 'runAction', 'listActions', 'optimizeAction'];
        for (const fnName of requiredWorldFns) {
            const exists = typeof world[fnName] === 'function';
            record(`world export ${fnName}`, exists);
        }

        try {
            const waitResult = await skills.wait(this.bot, 50);
            record('skills.wait runtime', waitResult === true);
        } catch (err) {
            record('skills.wait runtime', false, err.message);
        }

        try {
            const pos = this.bot.entity.position;
            const gotoResult = await skills.goToPosition(this.bot, pos.x, pos.y, pos.z, 0);
            record('skills.goToPosition runtime', gotoResult === true, `target=${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}`);
        } catch (err) {
            record('skills.goToPosition runtime', false, err.message);
        }

        const passed = results.filter(line => line.startsWith('PASS')).length;
        const failed = results.length - passed;
        return `Skill smoke harness:\n${results.join('\n')}\nSummary: ${passed} passed, ${failed} failed.`;
    }

    async runScenarioRegressionSuite() {
        const results = [];
        const record = (name, ok, detail = '') => {
            const status = ok ? 'PASS' : 'FAIL';
            results.push(`${status} ${name}${detail ? ` - ${detail}` : ''}`);
        };

        const optionalParse = parseCommandMessage('!getCraftingPlan("oak_planks")');
        record(
            'optional-param command parse',
            typeof optionalParse === 'object' && Array.isArray(optionalParse.args) && optionalParse.args[1] === 1,
            typeof optionalParse === 'string' ? optionalParse : `quantity=${optionalParse.args[1]}`
        );

        const intentInventory = this._routeIntentToCommand('show inventory now');
        record(
            'intent router inventory',
            intentInventory?.command === '!inventory',
            intentInventory ? intentInventory.reason : 'no match'
        );

        const intentCoords = this._routeIntentToCommand('go to x 10 y 64 z -4');
        record(
            'intent router coordinates',
            typeof intentCoords?.command === 'string' && intentCoords.command.startsWith('!goToCoordinates('),
            intentCoords ? intentCoords.command : 'no match'
        );

        const normalizedResult = this._normalizeCommandResult('!inventory', 'Action output:\nInventory opened.', 'suite-req-1', 'suite');
        record(
            'command-result schema v1',
            normalizedResult?.schema_version === 'v1' &&
            typeof normalizedResult.success === 'boolean' &&
            typeof normalizedResult.error_code === 'string' &&
            normalizedResult?.telemetry?.request_id === 'suite-req-1',
            `code=${normalizedResult?.error_code || 'missing'}`
        );

        const actionSchema = await this.actions.runAction('scenario:noop', async () => { }, { timeout: 1 });
        record(
            'action-manager schema v1',
            actionSchema?.schema_version === 'v1' &&
            typeof actionSchema.success === 'boolean' &&
            typeof actionSchema.error_code === 'string' &&
            typeof actionSchema.telemetry?.duration_ms === 'number'
        );

        const idOne = this._nextRequestId('suite');
        const idTwo = this._nextRequestId('suite');
        record('request-id uniqueness', idOne !== idTwo, `${idOne} | ${idTwo}`);

        const passed = results.filter(line => line.startsWith('PASS')).length;
        const failed = results.length - passed;
        return `Scenario regression suite:\n${results.join('\n')}\nSummary: ${passed} passed, ${failed} failed.`;
    }

    getLongTermGoalContext() {
        if (!this.recursive_tasks.root || this.recursive_tasks.isPaused) {
            return '';
        }
        const leaf = this.recursive_tasks._findNextLeaf(this.recursive_tasks.root);
        if (!leaf) {
            return '';
        }
        return [
            `Long-term mission: ${this.recursive_tasks.root.desc}`,
            `Current recursive sub-task: ${leaf.desc}`,
            'Prefer reusing known scripts with world.runAction(action_name) when possible.'
        ].join('\n');
    }

    async startLongTermGoal(missionPrompt) {
        // Stop self_prompter if active — it blocks RecursiveTaskManager from running
        if (this.self_prompter.isActive()) {
            await this.self_prompter.stop();
        }
        return await this.recursive_tasks.startMission(missionPrompt);
    }

    pauseLongTermGoal(paused = true) {
        return this.recursive_tasks.pauseMission(paused);
    }

    clearLongTermGoal() {
        return this.recursive_tasks.clearMission();
    }

    getLongTermGoalStatus() {
        return this.recursive_tasks.getMissionStatus();
    }

    async maybeRunLongTermGoal(trigger = 'idle') {
        return await this.recursive_tasks.maybeRunMission();
    }


    cleanKill(msg = 'Killing agent process...', code = 1) {
        this.history.add('system', msg);
        this.bot.chat(code > 1 ? 'Restarting.' : 'Exiting.');
        this.history.save();
        this.memory_bank.saveSpatialMemory();
        process.exit(code);
    }
    async checkTaskDone() {
        if (this.task.data) {
            let res = this.task.isDone();
            if (res) {
                await this.history.add('system', `Task ended with score : ${res.score}`);
                await this.history.save();
                // await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 second for save to complete
                console.log('Task finished:', res.message);
                this.killAll();
            }
        }
    }

    killAll() {
        serverProxy.shutdown();
    }
}
