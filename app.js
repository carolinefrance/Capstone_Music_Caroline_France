// Global variable to hold our catalog
let catalogData = [];
const features = ['danceability', 'energy', 'loudness', 'speechiness', 'acousticness', 'instrumentalness', 'valence', 'tempo'];

// 1. Load the exported JSON data
fetch('stones_catalog.json')
    .then(response => response.json())
    .then(data => { catalogData = data; })
    .catch(error => console.error("Error loading JSON. Are you running a local server?", error));

// 2. UI Elements
const btnRecommend = document.getElementById('btn-recommend');
const btnStop = document.getElementById('btn-stop');
const trackInput = document.getElementById('track-input');
const outputDiv = document.getElementById('output');

// 3. Event Listeners
btnRecommend.addEventListener('click', () => handleSearch(trackInput.value));
btnStop.addEventListener('click', resetApp);
trackInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') handleSearch(trackInput.value);
});

// 4. The Search Controller (Handles Typos, Punctuation, and Remasters)
function handleSearch(query) {
    query = query.trim();
    if (!query) {
        outputDiv.innerHTML = '<span class="error">Please enter a track name.</span>';
        return;
    }
    if (catalogData.length === 0) {
        outputDiv.innerHTML = '<span class="error">Data is still loading or failed to load.</span>';
        return;
    }

    // Attempt 1: Exact or Case-Insensitive Match
    let matches = catalogData.filter(t => t.name.toLowerCase() === query.toLowerCase());

    // Attempt 1.5: Substring Match (The "Spotify Remaster" Fix)
    // If they type "Wild Horses", this catches "Wild Horses - 2009 Remaster"
    if (matches.length === 0) {
        matches = catalogData.filter(t => t.name.toLowerCase().includes(query.toLowerCase()));
    }

    // Attempt 2: Normalized Match (Ignores spaces, commas, punctuation)
    if (matches.length === 0) {
        const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
        const normalizedQuery = normalize(query);
        matches = catalogData.filter(t => normalize(t.name) === normalizedQuery);
    }

    // If we found a match via Attempt 1, 1.5, or 2, run it!
    if (matches.length > 0) {
        // Grab the most popular version if there are multiple remasters found
        const seedTrack = matches.sort((a, b) => b.popularity - a.popularity)[0];
        executeEngine(seedTrack);
        return;
    }
    // Attempt 3: Levenshtein Distance (Did you mean...?)
    const closestMatch = findClosestSpelling(query, catalogData);
    
    // If the typo is relatively close (less than 5 letters wrong)
    if (closestMatch && closestMatch.distance < 5) {
        outputDiv.innerHTML = `
            <span class="error">We couldn't find exactly '${query}'.</span><br><br>
            <strong>Did you mean:</strong> 
            <button class="suggestion-btn" onclick="document.getElementById('track-input').value = '${closestMatch.track.name.replace(/'/g, "\\'")}'; document.getElementById('btn-recommend').click();" style="background: #1DB954; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-left: 10px;">
                ${closestMatch.track.name}
            </button>
        `;
    } else {
        outputDiv.innerHTML = `<span class="error">We couldn't find '${query}' or anything close to it in the catalog.</span>`;
    }
}

// 5. The Core Recommendation Engine Math
function executeEngine(seedTrack) {
    // Filter down to the same Sonic Cohort
    const cohortData = catalogData.filter(t => t.cohort === seedTrack.cohort);

    // Standardize features & Calculate Cosine Similarity
    const scaledCohort = standardizeFeatures(cohortData);
    const seedVector = scaledCohort.find(t => t.name === seedTrack.name).scaledVector;

    scaledCohort.forEach(track => {
        track.similarityScore = calculateCosineSimilarity(seedVector, track.scaledVector);
    });

    // Sort and grab top 5 (excluding the seed track itself)
    const recommendations = scaledCohort
        .filter(t => t.name !== seedTrack.name)
        .sort((a, b) => b.similarityScore - a.similarityScore)
        .slice(0, 5);

    // Render Results
    let htmlContent = `<h3>Analyzing: '${seedTrack.name}' (Album: ${seedTrack.album})</h3>`;
    htmlContent += `<h4>Top 5 Sonic Matches</h4>`;
    
    recommendations.forEach((track, index) => {
        const matchPercent = (track.similarityScore * 100).toFixed(1);
        
        // 1. Clean the URI (removes 'spotify:track:' if it exists)
        const cleanId = track.uri ? track.uri.replace('spotify:track:', '') : '';
        
        // 2. Construct the dynamic link 
        // (Using the standard Spotify Web Player format, but you can swap this for any base URL)
        const trackUrl = `https://open.spotify.com/track/${cleanId}`;

        // 3. Wrap the track name in an anchor <a> tag
        // Notice target="_blank" - this ensures the link opens in a new tab so the user doesn't lose the app!
        htmlContent += `
            <div class="track-item">
                <strong>${index + 1}. 
                    <a href="${trackUrl}" target="_blank" style="color: #1DB954; text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 0.2s;" onmouseover="this.style.borderBottom='1px solid #1DB954'" onmouseout="this.style.borderBottom='1px solid transparent'">
                        ${track.name}
                    </a>
                </strong> 
                (${track.release_year || 'Unknown Year'})
                <span class="match-score" style="font-weight: bold; color: #1DB954; float: right;">${matchPercent}% Match</span>
            </div>
        `;
    });

    outputDiv.innerHTML = htmlContent;
}

function resetApp() {
    trackInput.value = '';
    outputDiv.innerHTML = '<em>Awaiting your input...</em>';
    trackInput.focus();
}

// --- MATHEMATICAL HELPER FUNCTIONS ---

function standardizeFeatures(data) {
    const stats = {};
    features.forEach(f => {
        const values = data.map(d => d[f]);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
        stats[f] = { mean: mean, std: Math.sqrt(variance) || 1 }; 
    });
    return data.map(d => {
        const vector = features.map(f => (d[f] - stats[f].mean) / stats[f].std);
        return { ...d, scaledVector: vector };
    });
}

function calculateCosineSimilarity(vecA, vecB) {
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// The Levenshtein Distance Algorithm (Calculates typo severity)
function findClosestSpelling(query, catalog) {
    let bestMatch = null;
    let minDistance = Infinity;

    catalog.forEach(track => {
        let a = query.toLowerCase();
        let b = track.name.toLowerCase();
        let matrix = [];

        for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
        for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        Math.min(matrix[i][j - 1] + 1, // insertion
                        matrix[i - 1][j] + 1) // deletion
                    );
                }
            }
        }
        
        let distance = matrix[b.length][a.length];
        if (distance < minDistance) {
            minDistance = distance;
            bestMatch = track;
        }
    });

    return { track: bestMatch, distance: minDistance };
}