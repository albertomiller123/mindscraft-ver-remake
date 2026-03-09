export class ActionManager {
    constructor(agent) {
        this.agent = agent;
        this.executing = false;
        this.currentActionLabel = '';
        this.currentActionFn = null;
        this.timedout = false;
        this.resume_func = null;
        this.resume_name = '';
        this.last_action_time = 0;
        this.recent_action_counter = 0;
        this.last_resume_time = 0;
        this.recent_resume_counter = 0;
        this.currentActionProtected = false; // Flag to prevent interruptions during critical tasks
    }

    async resumeAction(actionFn, timeout) {
        return this._executeResume(actionFn, timeout);
    }

    async runAction(actionLabel, actionFn, { timeout, resume = false, protectedAction = false, forceInterrupt = false } = {}) {
        if (resume) {
            return this._executeResume(actionLabel, actionFn, timeout, protectedAction);
        } else {
            return this._executeAction(actionLabel, actionFn, timeout, protectedAction, forceInterrupt);
        }
    }

    async stop(forced = false) {
        if (!this.executing) return;

        // If action is protected and not forced, we don't interrupt.
        if (this.currentActionProtected && !forced) {
            console.log(`Action "${this.currentActionLabel}" is protected. Delaying interruption...`);
            return;
        }

        if (forced) {
            console.log(`Action "${this.currentActionLabel}" is being FORCIBLY interrupted.`);
            this.agent.requestInterrupt();
            this.executing = false; // Bypass the while loop deadlock
            return;
        }

        const timeout = setTimeout(() => {
            this.agent.cleanKill('Code execution refused stop after 10 seconds. Killing process.');
        }, 10000);
        while (this.executing) {
            this.agent.requestInterrupt();
            console.log('waiting for code to finish executing...');
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        clearTimeout(timeout);
    }

    cancelResume() {
        this.resume_func = null;
        this.resume_name = null;
    }

    async _executeResume(actionLabel = null, actionFn = null, timeout = 10, protectedAction = false) {
        const new_resume = actionFn != null;
        if (new_resume) { // start new resume
            this.resume_func = actionFn;
            if (actionLabel == null) {
                throw new Error('actionLabel is required for new resume');
            }
            this.resume_name = actionLabel;
        }
        if (this.resume_func != null && (this.agent.isIdle() || new_resume) && (!this.agent.self_prompter.isActive() || new_resume)) {
            this.currentActionLabel = this.resume_name;

            // Kiểm tra Fast Resume Loop (LLM bị lú, gọi resume liên tục)
            if (this.last_resume_time > 0) {
                let time_diff = Date.now() - this.last_resume_time;
                if (time_diff < 1000) { // Giới hạn 1 giây cho 1 lần resume (tránh spam API/spam context)
                    this.recent_resume_counter++;
                } else {
                    this.recent_resume_counter = 0;
                }

                if (this.recent_resume_counter > 3) {
                    console.warn('Fast resume loop detected, cancelling resume to prevent hallucination API spam.');
                    this.cancelResume();
                }
                if (this.recent_resume_counter > 5) {
                    console.error('Infinite resume loop detected, aborting action and delegating to Task Tree.');
                    this.agent.shutUp(); // Dừng spam LLM thay vì tắt server
                    const nowIso = new Date().toISOString();
                    return {
                        schema_version: 'v1',
                        success: false,
                        error_code: 'resume_loop_detected',
                        reason: 'Infinite resume loop detected, aborting action.',
                        telemetry: {
                            action_label: this.resume_name || actionLabel || null,
                            request_id: this.agent.current_request_id || null,
                            duration_ms: 0,
                            output_chars: 45,
                            started_at: nowIso,
                            finished_at: nowIso
                        },
                        message: 'Infinite resume loop detected, aborting action.',
                        interrupted: false,
                        timedout: false
                    };
                }
            }
            this.last_resume_time = Date.now();

            let res = await this._executeAction(this.resume_name, this.resume_func, timeout, protectedAction);
            this.currentActionLabel = '';
            return res;
        } else {
            const nowIso = new Date().toISOString();
            return {
                schema_version: 'v1',
                success: false,
                error_code: 'skipped',
                reason: 'Resume action skipped because agent is busy or no resume action exists.',
                telemetry: {
                    action_label: this.resume_name || actionLabel || null,
                    request_id: this.agent.current_request_id || null,
                    duration_ms: 0,
                    output_chars: 0,
                    started_at: nowIso,
                    finished_at: nowIso
                },
                message: '',
                interrupted: false,
                timedout: false
            };
        }
    }

    async _executeAction(actionLabel, actionFn, timeout = 10, protectedAction = false, forceInterrupt = false) {
        let TIMEOUT;
        const startedAt = Date.now();
        try {
            // Reset timeout flag for each new action run.
            this.timedout = false;

            // Xóa phần bẫy lỗi ở đây do đã chuyển qua quản lý trên resumeAction thay vì every code execution. Thả tự do thời gian vòng lặp nội tại của _executeAction
            this.last_action_time = Date.now();
            console.log('executing code...\n');

            // await current action to finish (executing=false), with 10 seconds timeout
            // also tell agent.bot to stop various actions
            if (this.executing) {
                console.log(`action "${actionLabel}" trying to interrupt current action "${this.currentActionLabel}"${forceInterrupt ? ' (FORCED)' : ''}`);
            }
            await this.stop(forceInterrupt);

            // clear bot logs and reset interrupt code
            this.agent.clearBotLogs();

            this.executing = true;
            this.currentActionLabel = actionLabel;
            this.currentActionFn = actionFn;
            this.currentActionProtected = protectedAction;

            // timeout in minutes
            if (timeout > 0) {
                TIMEOUT = this._startTimeout(timeout);
            }

            // start the action
            await actionFn();

            // mark action as finished + cleanup
            this.executing = false;
            this.currentActionLabel = '';
            this.currentActionFn = null;
            clearTimeout(TIMEOUT);
            this.cancelResume();

            // get bot activity summary
            let output = this.getBotOutputSummary();
            let interrupted = this.agent.bot.interrupt_code;
            let timedout = this.timedout;
            this.agent.clearBotLogs();
            const outputLower = String(output || '').toLowerCase();
            const semanticFailure = /\n\s*failed\b/i.test(output) || outputLower.includes("couldn't") || outputLower.includes('could not ');
            const errorCode = timedout
                ? 'timeout'
                : (interrupted
                    ? 'interrupted'
                    : (semanticFailure ? 'execution_failed' : 'none'));
            const success = !timedout && !interrupted && !semanticFailure;
            const reason = timedout
                ? `Action "${actionLabel}" timed out.`
                : (interrupted
                    ? `Action "${actionLabel}" was interrupted.`
                    : (semanticFailure
                        ? `Action "${actionLabel}" finished with failure output.`
                        : `Action "${actionLabel}" completed successfully.`));
            const telemetry = {
                action_label: actionLabel,
                request_id: this.agent.current_request_id || null,
                duration_ms: Date.now() - startedAt,
                output_chars: output ? output.length : 0,
                started_at: new Date(startedAt).toISOString(),
                finished_at: new Date().toISOString()
            };

            // if not interrupted and not generating, emit idle event
            if (!interrupted) {
                this.agent.bot.emit('idle');
            }

            // return action status report
            return {
                schema_version: 'v1',
                success,
                error_code: errorCode,
                reason,
                telemetry,
                message: output,
                interrupted,
                timedout
            };
        } catch (err) {
            this.executing = false;
            this.currentActionLabel = '';
            this.currentActionFn = null;
            clearTimeout(TIMEOUT);
            this.cancelResume();
            console.error("Code execution triggered catch:", err);
            // Log the full stack trace before formatting for output.
            const errText = err instanceof Error ? err.toString() : String(err);
            const errStack = err && err.stack ? err.stack : 'No stack trace available.';
            console.error(errStack);
            await this.stop();

            let message = this.getBotOutputSummary() +
                '!!Code threw exception!!\n' +
                'Error: ' + errText + '\n' +
                'Stack trace:\n' + errStack + '\n';

            let interrupted = this.agent.bot.interrupt_code;
            this.agent.clearBotLogs();
            const telemetry = {
                action_label: actionLabel,
                request_id: this.agent.current_request_id || null,
                duration_ms: Date.now() - startedAt,
                output_chars: message.length,
                started_at: new Date(startedAt).toISOString(),
                finished_at: new Date().toISOString()
            };
            if (!interrupted) {
                this.agent.bot.emit('idle');
            }
            return {
                schema_version: 'v1',
                success: false,
                error_code: interrupted ? 'interrupted' : 'exception',
                reason: interrupted
                    ? `Action "${actionLabel}" was interrupted while handling an exception.`
                    : `Action "${actionLabel}" threw an exception.`,
                telemetry,
                message,
                interrupted,
                timedout: false
            };
        }
    }

    getBotOutputSummary() {
        const { bot } = this.agent;
        if (bot.interrupt_code && !this.timedout) return '';
        let output = bot.output;
        const MAX_OUT = 500;
        if (output.length > MAX_OUT) {
            output = `Action output is very long (${output.length} chars) and has been shortened.\n
          First outputs:\n${output.substring(0, MAX_OUT / 2)}\n...skipping many lines.\nFinal outputs:\n ${output.substring(output.length - MAX_OUT / 2)}`;
        }
        else {
            output = 'Action output:\n' + output.toString();
        }
        bot.output = '';
        return output;
    }

    _startTimeout(TIMEOUT_MINS = 10) {
        return setTimeout(async () => {
            console.warn(`Code execution timed out after ${TIMEOUT_MINS} minutes. Attempting force stop.`);
            this.timedout = true;
            this.agent.history.add('system', `Code execution timed out after ${TIMEOUT_MINS} minutes. Attempting force stop.`);
            await this.stop(); // last attempt to stop
        }, TIMEOUT_MINS * 60 * 1000);
    }

}
