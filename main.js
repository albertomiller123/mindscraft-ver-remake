import * as Mindcraft from './src/mindcraft/mindcraft.js';
import settings from './settings.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync } from 'fs';
import { sanitizeFilePath, safeJsonParse, validateProfile } from './src/utils/profile_validator.js';

function parseArguments() {
    return yargs(hideBin(process.argv))
        .option('profiles', {
            type: 'array',
            describe: 'List of agent profile paths',
        })
        .option('task_path', {
            type: 'string',
            describe: 'Path to task file to execute'
        })
        .option('task_id', {
            type: 'string',
            describe: 'Task ID to execute'
        })
        .help()
        .alias('help', 'h')
        .parse();
}
const args = parseArguments();
if (args.profiles) {
    settings.profiles = args.profiles;
}
if (args.task_path) {
    let tasks = JSON.parse(readFileSync(args.task_path, 'utf8'));
    if (args.task_id) {
        settings.task = tasks[args.task_id];
        settings.task.task_id = args.task_id;
    }
    else {
        throw new Error('task_id is required when task_path is provided');
    }
}

// these environment variables override certain settings
if (process.env.MINECRAFT_PORT) {
    settings.port = process.env.MINECRAFT_PORT;
}
if (process.env.MINDSERVER_PORT) {
    settings.mindserver_port = process.env.MINDSERVER_PORT;
}
if (process.env.PROFILES && JSON.parse(process.env.PROFILES).length > 0) {
    settings.profiles = JSON.parse(process.env.PROFILES);
}
if (process.env.INSECURE_CODING) {
    settings.allow_insecure_coding = true;
}
if (process.env.BLOCKED_ACTIONS) {
    settings.blocked_actions = JSON.parse(process.env.BLOCKED_ACTIONS);
}
if (process.env.MAX_MESSAGES) {
    settings.max_messages = process.env.MAX_MESSAGES;
}
if (process.env.NUM_EXAMPLES) {
    settings.num_examples = process.env.NUM_EXAMPLES;
}
if (process.env.LOG_ALL) {
    settings.log_all_prompts = process.env.LOG_ALL;
}

Mindcraft.init(true, settings.mindserver_port, settings.auto_open_ui);

if (!settings.profiles || settings.profiles.length === 0) {
    console.error('Error: No agent profiles specified. Add profiles to settings.js or pass --profiles.');
    process.exit(1);
}

for (let profile of settings.profiles) {
    // Validate and sanitize profile path
    const pathValidation = sanitizeFilePath(profile);
    if (!pathValidation.valid) {
        console.error(`Error: Invalid profile path '${profile}': ${pathValidation.error}`);
        process.exit(1);
    }
    
    let profile_json;
    try {
        const fileContent = readFileSync(pathValidation.sanitized, 'utf8');
        const jsonResult = safeJsonParse(fileContent, profile);
        
        if (!jsonResult.success) {
            console.error(`Error: Failed to parse profile '${profile}': ${jsonResult.error}`);
            process.exit(1);
        }
        
        profile_json = jsonResult.data;
    } catch (err) {
        console.error(`Error: Failed to load profile '${profile}': ${err.message}`);
        process.exit(1);
    }
    
    // Validate profile structure
    const validation = validateProfile(profile_json);
    if (!validation.valid) {
        console.error(`Error: Profile '${profile}' validation failed:`);
        validation.errors.forEach(err => console.error(`  - ${err}`));
        process.exit(1);
    }
    
    if (!profile_json.name) {
        console.error(`Error: Profile '${profile}' is missing required 'name' field.`);
        process.exit(1);
    }
    
    settings.profile = profile_json;
    Mindcraft.createAgent(settings);
}