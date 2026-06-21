/**
 * ai.js - Catan AI Player Heuristic Engine
 */

window.CatanAI = (function() {
    // Dice probability dots helper
    const DOTS = {
        2: 1, 12: 1,
        3: 2, 11: 2,
        4: 3, 10: 3,
        5: 4, 9: 4,
        6: 5, 8: 5,
        null: 0,
        0: 0
    };

    /**
     * Scores a vertex based on adjacent tiles' production value and resource variety.
     */
    function scoreVertex(board, vertexId, myPlayerId) {
        const vertex = board.vertices[vertexId];
        let totalDots = 0;
        const resources = new Set();

        vertex.adjacentTiles.forEach(tileId => {
            const tile = board.tiles[tileId];
            if (tile.resource !== 'desert') {
                const dots = DOTS[tile.number] || 0;
                totalDots += dots;
                resources.add(tile.resource);
            }
        });

        // Basic score is total dots
        let score = totalDots;

        // Resource diversity bonus (up to 1.5x)
        if (resources.size > 1) {
            score += resources.size * 1.5;
        }

        // Harbor bonus
        if (vertex.harbor !== null) {
            score += 2.0; // small boost for port spots
        }

        return score;
    }

    /**
     * Choose the best vertex for a settlement during setup phase.
     */
    function chooseSetupSettlement(board, playerId) {
        let bestVertexId = -1;
        let bestScore = -1;

        for (let i = 0; i < board.vertices.length; i++) {
            if (window.CatanBoard.isVertexBuildable(board, i, playerId, true)) {
                const score = scoreVertex(board, i, playerId);
                if (score > bestScore) {
                    bestScore = score;
                    bestVertexId = i;
                }
            }
        }

        return bestVertexId;
    }

    /**
     * Choose the best road edge during setup phase (adjacent to the new settlement).
     */
    function chooseSetupRoad(board, settlementVertexId, playerId) {
        const vertex = board.vertices[settlementVertexId];
        let bestEdgeId = -1;
        let bestScore = -1;

        for (const edgeId of vertex.adjacentEdges) {
            if (window.CatanBoard.isEdgeBuildable(board, edgeId, playerId, true, settlementVertexId)) {
                // Heuristic: choose the edge that leads to the highest scoring neighboring vertex
                const edge = board.edges[edgeId];
                const neighborVertexId = (edge.v1 === settlementVertexId) ? edge.v2 : edge.v1;
                const score = scoreVertex(board, neighborVertexId, playerId);

                if (score > bestScore) {
                    bestScore = score;
                    bestEdgeId = edgeId;
                }
            }
        }

        // Fallback to any valid edge
        if (bestEdgeId === -1) {
            bestEdgeId = vertex.adjacentEdges.find(edgeId => 
                window.CatanBoard.isEdgeBuildable(board, edgeId, playerId, true, settlementVertexId)
            );
        }

        return bestEdgeId;
    }

    /**
     * Helper to check resource counts.
     */
    function hasResources(player, cost) {
        return Object.keys(cost).every(res => (player.resources[res] || 0) >= cost[res]);
    }

    /**
     * AI Turn decision logic.
     */
    function makeTurnDecision(gameState, playerId) {
        const player = gameState.players.find(p => p.id === playerId);
        const board = gameState.board;

        const roadCost = { wood: 1, brick: 1 };
        const settlementCost = { wood: 1, brick: 1, sheep: 1, wheat: 1 };
        const cityCost = { wheat: 2, ore: 3 };
        const devCardCost = { sheep: 1, wheat: 1, ore: 1 };

        // 1. Upgrade Settlement to City (High priority for production spike)
        if (hasResources(player, cityCost)) {
            let bestVertexId = -1;
            let bestScore = -1;
            for (let i = 0; i < board.vertices.length; i++) {
                if (window.CatanBoard.isVertexUpgradable(board, i, playerId)) {
                    const score = scoreVertex(board, i, playerId);
                    if (score > bestScore) {
                        bestScore = score;
                        bestVertexId = i;
                    }
                }
            }
            if (bestVertexId !== -1) {
                return { type: 'UPGRADE_CITY', vertexId: bestVertexId };
            }
        }

        // 2. Build Settlement
        if (hasResources(player, settlementCost)) {
            let bestVertexId = -1;
            let bestScore = -1;
            for (let i = 0; i < board.vertices.length; i++) {
                if (window.CatanBoard.isVertexBuildable(board, i, playerId, false)) {
                    const score = scoreVertex(board, i, playerId);
                    if (score > bestScore) {
                        bestScore = score;
                        bestVertexId = i;
                    }
                }
            }
            if (bestVertexId !== -1) {
                return { type: 'BUILD_SETTLEMENT', vertexId: bestVertexId };
            }
        }

        // 3. Play Dev Card (Knight) if Robber is blocking us
        if (player.devCards.knight > 0 && !gameState.turnState.devCardPlayedThisTurn) {
            // Check if our high-yielding tile is blocked by the Robber
            const myTiles = new Set();
            board.vertices.forEach(v => {
                if (v.building !== null && v.building.playerId === playerId) {
                    v.adjacentTiles.forEach(tId => myTiles.add(tId));
                }
            });

            const isBlocked = myTiles.has(board.robberTileId);
            if (isBlocked) {
                // Choose robber placement
                const { tileId, stealPlayerId } = chooseRobberPlacement(board, playerId, gameState.players);
                return { type: 'PLAY_KNIGHT', tileId, stealPlayerId };
            }
        }

        // 4. Build Road (to expand towards settlement spots)
        if (hasResources(player, roadCost)) {
            let bestEdgeId = -1;
            let bestScore = -1;
            for (let i = 0; i < board.edges.length; i++) {
                if (window.CatanBoard.isEdgeBuildable(board, i, playerId, false)) {
                    // Score based on neighbor vertices
                    const edge = board.edges[i];
                    const s1 = scoreVertex(board, edge.v1, playerId);
                    const s2 = scoreVertex(board, edge.v2, playerId);
                    const score = Math.max(s1, s2);
                    if (score > bestScore) {
                        bestScore = score;
                        bestEdgeId = i;
                    }
                }
            }
            if (bestEdgeId !== -1) {
                return { type: 'BUILD_ROAD', edgeId: bestEdgeId };
            }
        }

        // 5. Buy Development Card
        if (hasResources(player, devCardCost) && gameState.devCardDeckSize > 0) {
            return { type: 'BUY_DEV_CARD' };
        }

        // 6. Maritime Trade (if we are close to building but missing a resource)
        // Check trade rates
        const tradeRates = getTradeRates(board, playerId);
        const desiredBuilds = [
            { cost: settlementCost, action: 'settlement' },
            { cost: cityCost, action: 'city' },
            { cost: roadCost, action: 'road' },
            { cost: devCardCost, action: 'devCard' }
        ];

        for (const build of desiredBuilds) {
            const missing = [];
            const surplus = [];

            // Find missing resources for this target build
            Object.keys(build.cost).forEach(res => {
                const count = player.resources[res] || 0;
                const req = build.cost[res];
                if (count < req) {
                    for (let k = 0; k < (req - count); k++) missing.push(res);
                }
            });

            // Find surplus resources (anything above what the build requires + safe buffer of 2)
            Object.keys(player.resources).forEach(res => {
                const count = player.resources[res] || 0;
                const req = build.cost[res] || 0;
                const rate = tradeRates[res];
                if (count > req + rate) {
                    const extra = count - req;
                    const tradeCount = Math.floor(extra / rate);
                    for (let k = 0; k < tradeCount; k++) {
                        surplus.push({ resource: res, rate });
                    }
                }
            });

            // If we can trade surplus to get missing, let's do it!
            if (missing.length > 0 && surplus.length >= missing.length) {
                const give = surplus[0].resource;
                const get = missing[0];
                return { type: 'MARITIME_TRADE', giveResource: give, getResource: get, count: tradeRates[give] };
            }
        }

        // 7. End Turn
        return { type: 'END_TURN' };
    }

    /**
     * Helper to get maritime trade rates for a player.
     */
    function getTradeRates(board, playerId) {
        const rates = { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };

        // Check if player has any harbor settlements
        board.vertices.forEach(v => {
            if (v.building !== null && v.building.playerId === playerId && v.harbor !== null) {
                const type = v.harbor.type;
                if (type === '3:1') {
                    // Generic 3:1 replaces any rate of 4 with 3
                    Object.keys(rates).forEach(res => {
                        if (rates[res] > 3) rates[res] = 3;
                    });
                } else {
                    // Specialized 2:1
                    rates[type] = 2;
                }
            }
        });

        return rates;
    }

    /**
     * Decide where to place the Robber and who to steal from.
     */
    function chooseRobberPlacement(board, myPlayerId, players) {
        let bestTileId = -1;
        let bestScore = -1;
        let bestStealPlayerId = null;

        board.tiles.forEach(tile => {
            if (tile.resource === 'desert' || tile.id === board.robberTileId) return;

            // Score this tile: count opponent buildings and their points
            let tileScore = 0;
            let candidates = [];

            tile.vertices.forEach(vId => {
                const v = board.vertices[vId];
                if (v.building !== null) {
                    const ownerId = v.building.playerId;
                    if (ownerId !== myPlayerId) {
                        const owner = players.find(p => p.id === ownerId);
                        const weight = (v.building.type === 'city') ? 2 : 1;
                        // Add points based on dice probability and opponent's VP
                        tileScore += (DOTS[tile.number] || 0) * weight * (owner.victoryPoints || 2);
                        candidates.push(ownerId);
                    } else {
                        // Avoid blocking our own buildings if possible
                        tileScore -= 10;
                    }
                }
            });

            if (tileScore > bestScore && candidates.length > 0) {
                bestScore = tileScore;
                bestTileId = tile.id;

                // Pick the candidate with the most victory points or resource cards
                candidates.sort((a, b) => {
                    const pA = players.find(p => p.id === a);
                    const pB = players.find(p => p.id === b);
                    const cardsA = Object.values(pA.resources).reduce((sum, v) => sum + v, 0);
                    const cardsB = Object.values(pB.resources).reduce((sum, v) => sum + v, 0);
                    return (pB.victoryPoints - pA.victoryPoints) || (cardsB - cardsA);
                });
                bestStealPlayerId = candidates[0];
            }
        });

        // Fallback: Pick a random tile that has an opponent building
        if (bestTileId === -1) {
            const eligibleTiles = board.tiles.filter(t => t.id !== board.robberTileId && t.resource !== 'desert');
            if (eligibleTiles.length > 0) {
                bestTileId = eligibleTiles[Math.floor(Math.random() * eligibleTiles.length)].id;
            } else {
                bestTileId = 0;
            }
        }

        return { tileId: bestTileId, stealPlayerId: bestStealPlayerId };
    }

    /**
     * Choose which cards to discard when player has >7 cards on a 7 dice roll.
     */
    function chooseDiscardCards(resources, discardCount) {
        const hand = [];
        Object.keys(resources).forEach(res => {
            for (let i = 0; i < resources[res]; i++) {
                hand.push(res);
            }
        });

        const discarded = {};
        // Heuristic: discard the resource we have the most of
        for (let i = 0; i < discardCount; i++) {
            // Count current resources in our temp hand
            const counts = {};
            hand.forEach(res => counts[res] = (counts[res] || 0) + 1);

            let maxRes = null;
            let maxCount = -1;

            Object.keys(counts).forEach(res => {
                if (counts[res] > maxCount) {
                    maxCount = counts[res];
                    maxRes = res;
                }
            });

            if (maxRes) {
                // Remove one instance of maxRes from hand
                const idx = hand.indexOf(maxRes);
                hand.splice(idx, 1);

                // Add to discarded object
                discarded[maxRes] = (discarded[maxRes] || 0) + 1;
            }
        }

        return discarded;
    }

    return {
        chooseSetupSettlement,
        chooseSetupRoad,
        makeTurnDecision,
        chooseRobberPlacement,
        chooseDiscardCards
    };
})();
