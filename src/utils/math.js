/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} Similarity score between -1 and 1, or 0 if either vector is zero
 */
export function cosineSimilarity(a, b) {
    if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) {
        return 0; // Return 0 for invalid inputs
    }
    
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    
    for (let i = 0; i < a.length; i++) {
        const aVal = Number(a[i]) || 0; // Handle NaN/undefined
        const bVal = Number(b[i]) || 0;
        dotProduct += aVal * bVal;
        magnitudeA += aVal * aVal;
        magnitudeB += bVal * bVal;
    }
    
    // Handle zero vectors - return 0 similarity instead of NaN
    if (magnitudeA === 0 || magnitudeB === 0) {
        return 0;
    }
    
    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);
    
    const similarity = dotProduct / (magnitudeA * magnitudeB);
    
    // Clamp to [-1, 1] to handle floating point errors
    return Math.max(-1, Math.min(1, similarity));
}