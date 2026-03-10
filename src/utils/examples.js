import { cosineSimilarity } from './math.js';
import { stringifyTurns, wordOverlapScore } from './text.js';

export class Examples {
    constructor(model, select_num=2) {
        this.examples = [];
        this.model = model;
        this.select_num = select_num;
        this.embeddings = {};
        this._loadingPromise = null; // Track ongoing load operations
    }

    /**
     * Convert turns to text representation for embedding
     * @param {Array} turns - Conversation turns
     * @returns {string} Text representation
     */
    turnsToText(turns) {
        if (!Array.isArray(turns)) {
            return '';
        }
        
        let messages = '';
        for (let turn of turns) {
            if (!turn || typeof turn.content !== 'string' || turn.role === 'assistant') {
                continue;
            }
            
            const colonIndex = turn.content.indexOf(':');
            const content = colonIndex >= 0 ? 
                turn.content.substring(colonIndex + 1).trim() : 
                turn.content.trim();
            
            messages += content + '\n';
        }
        return messages.trim();
    }

    /**
     * Load examples and generate embeddings
     * Prevents race conditions by returning existing load promise if called concurrently
     * @param {Array} examples - Array of conversation turns
     * @returns {Promise<void>}
     */
    async load(examples) {
        // If already loading, wait for that to complete
        if (this._loadingPromise) {
            console.warn('Load already in progress, waiting for completion...');
            await this._loadingPromise;
            return;
        }
        
        // Validate input
        if (!Array.isArray(examples)) {
            throw new Error('Examples must be an array');
        }
        
        this.examples = examples;
        
        // Early return if no embedding model or no selection needed
        if (!this.model || this.select_num === 0) {
            return;
        }

        // Create and store loading promise
        this._loadingPromise = (async () => {
            try {
                // Clear old embeddings
                this.embeddings = {};
                
                // Create array of promises first
                const embeddingPromises = examples.map(example => {
                    const turn_text = this.turnsToText(example);
                    return this.model.embed(turn_text)
                        .then(embedding => {
                            // Validate embedding
                            if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
                                console.warn(`Invalid embedding for example: ${turn_text.substring(0, 50)}...`);
                                return;
                            }
                            this.embeddings[turn_text] = embedding;
                        })
                        .catch(err => {
                            console.warn(`Failed to embed example: ${err.message}`);
                        });
                });
                
                // Wait for all embeddings to complete
                await Promise.all(embeddingPromises);
                
                console.log(`Loaded ${Object.keys(this.embeddings).length} embeddings from ${examples.length} examples`);
            } catch (err) {
                console.warn('Error with embedding model, using word-overlap instead.', err.message);
                this.model = null;
            } finally {
                this._loadingPromise = null;
            }
        })();
        
        await this._loadingPromise;
    }

    /**
     * Get most relevant examples for given conversation turns
     * @param {Array} turns - Current conversation turns
     * @returns {Promise<Array>} Selected relevant examples (deep copy)
     */
    async getRelevant(turns) {
        if (this.select_num === 0 || this.examples.length === 0) {
            return [];
        }
        
        // Wait for any ongoing load operation
        if (this._loadingPromise) {
            await this._loadingPromise;
        }

        let turn_text = this.turnsToText(turns);
        
        // Create a copy of examples array to avoid mutating original order
        let sortedExamples = [...this.examples];
        
        if (this.model !== null && Object.keys(this.embeddings).length > 0) {
            // Use embedding-based similarity
            try {
                let embedding = await this.model.embed(turn_text);
                
                // Calculate similarities for all examples
                const similarities = sortedExamples.map(example => {
                    const exampleText = this.turnsToText(example);
                    const exampleEmbedding = this.embeddings[exampleText];
                    
                    if (!exampleEmbedding) {
                        return { example, score: 0 };
                    }
                    
                    return {
                        example,
                        score: cosineSimilarity(embedding, exampleEmbedding)
                    };
                });
                
                // Sort by score descending
                similarities.sort((a, b) => b.score - a.score);
                sortedExamples = similarities.map(s => s.example);
            } catch (err) {
                console.warn('Error during embedding-based search, falling back to word overlap:', err.message);
                this.model = null;
            }
        }
        
        if (this.model === null) {
            // Fallback to word overlap
            const similarities = sortedExamples.map(example => ({
                example,
                score: wordOverlapScore(turn_text, this.turnsToText(example))
            }));
            
            similarities.sort((a, b) => b.score - a.score);
            sortedExamples = similarities.map(s => s.example);
        }
        
        let selected = sortedExamples.slice(0, this.select_num);
        
        // Use structuredClone if available (Node 17+), otherwise JSON fallback
        if (typeof structuredClone === 'function') {
            return structuredClone(selected);
        }
        return JSON.parse(JSON.stringify(selected)); // deep copy fallback
    }

    /**
     * Create formatted example message for prompt
     * @param {Array} turns - Current conversation turns
     * @returns {Promise<string>} Formatted examples message
     */
    async createExampleMessage(turns) {
        let selected_examples = await this.getRelevant(turns);
        
        if (selected_examples.length === 0) {
            return '';
        }

        console.log('selected examples:');
        for (let example of selected_examples) {
            if (Array.isArray(example) && example.length > 0 && example[0].content) {
                console.log('Example:', example[0].content.substring(0, 100));
            }
        }

        let msg = 'Examples of how to respond:\n';
        for (let i = 0; i < selected_examples.length; i++) {
            let example = selected_examples[i];
            msg += `Example ${i + 1}:\n${stringifyTurns(example)}\n\n`;
        }
        return msg;
    }
}