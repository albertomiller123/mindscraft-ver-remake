export function stringifyTurns(turns) {
    let res = '';
    for (let turn of turns) {
        if (turn.role === 'assistant') {
            res += `\nYour output:\n${turn.content}`;
        } else if (turn.role === 'system') {
            res += `\nSystem output: ${turn.content}`;
        } else {
            res += `\nUser input: ${turn.content}`;

        }
    }
    return res.trim();
}

export function toSinglePrompt(turns, system = null, stop_seq = '***', model_nickname = 'assistant') {
    let prompt = system ? `${system}${stop_seq}` : '';
    let role = '';
    turns.forEach((message) => {
        role = message.role;
        if (role === 'assistant') role = model_nickname;
        prompt += `${role}: ${message.content}${stop_seq}`;
    });
    if (role !== model_nickname) // if the last message was from the user/system, add a prompt for the model. otherwise, pretend we are extending the model's own message
        prompt += model_nickname + ": ";
    return prompt;
}

function _getWords(text) {
    if (!text || typeof text !== 'string') {
        return [];
    }
    return text.replace(/[^a-zA-Z ]/g, '').toLowerCase().split(' ').filter(w => w.length > 0);
}

/**
 * Calculate Jaccard similarity coefficient between two texts
 * @param {string} text1 - First text
 * @param {string} text2 - Second text
 * @returns {number} Similarity score between 0 and 1
 */
export function wordOverlapScore(text1, text2) {
    const words1 = _getWords(text1);
    const words2 = _getWords(text2);
    
    if (words1.length === 0 && words2.length === 0) {
        return 1; // Both empty = identical
    }
    if (words1.length === 0 || words2.length === 0) {
        return 0; // One empty = no overlap
    }
    
    // Use Set for correct Jaccard index calculation
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    
    // Intersection: words in both sets
    const intersection = new Set([...set1].filter(word => set2.has(word)));
    
    // Union: all unique words from both sets
    const union = new Set([...set1, ...set2]);
    
    // Jaccard index = |A ∩ B| / |A ∪ B|
    return intersection.size / union.size;
}

// ensures stricter turn order and roles:
// - system messages are treated as user messages and prefixed with SYSTEM:
// - combines repeated messages from users
// - separates repeat assistant messages with filler user messages
export function strictFormat(turns) {
    let prev_role = null;
    let messages = [];
    let filler = { role: 'user', content: '_' };
    for (let msg of turns) {
        if (typeof msg.content === 'string') {
            msg.content = msg.content.trim();
        }
        if (msg.role === 'system') {
            msg.role = 'user';
            msg.content = 'SYSTEM: ' + msg.content;
        }
        if (msg.role === prev_role && msg.role === 'assistant') {
            // insert empty user message to separate assistant messages
            messages.push(filler);
            messages.push(msg);
        }
        else if (msg.role === prev_role) {
            // combine new message with previous message instead of adding a new one
            messages[messages.length - 1].content += '\n' + msg.content;
        }
        else {
            messages.push(msg);
        }
        prev_role = msg.role;

    }
    if (messages.length > 0 && messages[0].role !== 'user') {
        messages.unshift(filler); // anthropic requires user message to start
    }
    if (messages.length === 0) {
        messages.push(filler);
    }
    return messages;
}