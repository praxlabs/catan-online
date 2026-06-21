/**
 * board.js - Catan Board Geometry and Rules Engine
 */

window.CatanBoard = (function() {
    const HEX_RADIUS = 75; // Standard radius for rendering
    const DX = Math.sqrt(3) * HEX_RADIUS;
    const DY = 1.5 * HEX_RADIUS;

    const RESOURCE_TYPES = {
        WOOD: 'wood',
        BRICK: 'brick',
        SHEEP: 'sheep',
        WHEAT: 'wheat',
        ORE: 'ore',
        DESERT: 'desert'
    };

    const HARBOR_TYPES = {
        GENERIC: '3:1',
        WOOD: 'wood',
        BRICK: 'brick',
        SHEEP: 'sheep',
        WHEAT: 'wheat',
        ORE: 'ore'
    };

    // Standard list of resources on a Catan board
    const STANDARD_RESOURCES = [
        RESOURCE_TYPES.WOOD, RESOURCE_TYPES.WOOD, RESOURCE_TYPES.WOOD, RESOURCE_TYPES.WOOD,
        RESOURCE_TYPES.SHEEP, RESOURCE_TYPES.SHEEP, RESOURCE_TYPES.SHEEP, RESOURCE_TYPES.SHEEP,
        RESOURCE_TYPES.WHEAT, RESOURCE_TYPES.WHEAT, RESOURCE_TYPES.WHEAT, RESOURCE_TYPES.WHEAT,
        RESOURCE_TYPES.BRICK, RESOURCE_TYPES.BRICK, RESOURCE_TYPES.BRICK,
        RESOURCE_TYPES.ORE, RESOURCE_TYPES.ORE, RESOURCE_TYPES.ORE,
        RESOURCE_TYPES.DESERT
    ];

    // Standard list of numbers (excluding desert, which gets no number)
    const STANDARD_NUMBERS = [
        2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12
    ];

    // Helper to shuffle an array
    function shuffle(array) {
        const copy = [...array];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    /**
     * Generates a Catan board.
     * @param {boolean} randomize - Whether to shuffle resources and numbers.
     */
    function createBoard(randomize = true) {
        // 1. Define the 19 Hexagon center coordinates in rows (3, 4, 5, 4, 3)
        const hexCenters = [
            // Row 0 (3 hexes)
            { r: 0, c: 0, x: -DX, y: -2 * DY }, { r: 0, c: 1, x: 0, y: -2 * DY }, { r: 0, c: 2, x: DX, y: -2 * DY },
            // Row 1 (4 hexes)
            { r: 1, c: 0, x: -1.5 * DX, y: -DY }, { r: 1, c: 1, x: -0.5 * DX, y: -DY }, { r: 1, c: 2, x: 0.5 * DX, y: -DY }, { r: 1, c: 3, x: 1.5 * DX, y: -DY },
            // Row 2 (5 hexes)
            { r: 2, c: 0, x: -2 * DX, y: 0 }, { r: 2, c: 1, x: -DX, y: 0 }, { r: 2, c: 2, x: 0, y: 0 }, { r: 2, c: 3, x: DX, y: 0 }, { r: 2, c: 4, x: 2 * DX, y: 0 },
            // Row 3 (4 hexes)
            { r: 3, c: 0, x: -1.5 * DX, y: DY }, { r: 3, c: 1, x: -0.5 * DX, y: DY }, { r: 3, c: 2, x: 0.5 * DX, y: DY }, { r: 3, c: 3, x: 1.5 * DX, y: DY },
            // Row 4 (3 hexes)
            { r: 4, c: 0, x: -DX, y: 2 * DY }, { r: 4, c: 1, x: 0, y: 2 * DY }, { r: 4, c: 2, x: DX, y: 2 * DY }
        ];

        // 2. Prepare resources and numbers
        let resources = randomize ? shuffle(STANDARD_RESOURCES) : [...STANDARD_RESOURCES];
        let numbers = randomize ? shuffle(STANDARD_NUMBERS) : [...STANDARD_NUMBERS];

        // Ensure desert does not get a number token, and robber starts on desert
        const tiles = [];
        let numIdx = 0;
        let robberTileId = 0;

        hexCenters.forEach((center, idx) => {
            const res = resources[idx];
            let num = null;
            let hasRobber = false;

            if (res === RESOURCE_TYPES.DESERT) {
                hasRobber = true;
                robberTileId = idx;
            } else {
                num = numbers[numIdx++];
            }

            tiles.push({
                id: idx,
                row: center.r,
                col: center.c,
                x: center.x,
                y: center.y,
                resource: res,
                number: num,
                hasRobber: hasRobber,
                vertices: [], // will hold vertex IDs
                edges: [] // will hold edge IDs
            });
        });

        // 3. Generate vertices (54 total) and edges (72 total)
        const vertices = [];
        const edges = [];

        // Epsilon for merging coordinates
        const EPSILON = 2.0;

        function getOrCreateVertex(x, y, tileId) {
            let found = vertices.find(v => Math.hypot(v.x - x, v.y - y) < EPSILON);
            if (!found) {
                found = {
                    id: vertices.length,
                    x: x,
                    y: y,
                    adjacentVertices: [],
                    adjacentEdges: [],
                    adjacentTiles: [],
                    building: null, // { type: 'settlement'|'city', playerId: X }
                    harbor: null
                };
                vertices.push(found);
            }
            if (!found.adjacentTiles.includes(tileId)) {
                found.adjacentTiles.push(tileId);
            }
            return found.id;
        }

        function getOrCreateEdge(v1, v2, tileId) {
            const minV = Math.min(v1, v2);
            const maxV = Math.max(v1, v2);
            let found = edges.find(e => e.v1 === minV && e.v2 === maxV);
            if (!found) {
                found = {
                    id: edges.length,
                    v1: minV,
                    v2: maxV,
                    adjacentEdges: [],
                    adjacentTiles: [],
                    road: null // playerId
                };
                edges.push(found);
            }
            if (!found.adjacentTiles.includes(tileId)) {
                found.adjacentTiles.push(tileId);
            }
            return found.id;
        }

        // Generate corners for pointy-topped hexagons
        // Corner angles are 30, 90, 150, 210, 270, 330 degrees
        const cornerAngles = [30, 90, 150, 210, 270, 330].map(deg => deg * Math.PI / 180);

        tiles.forEach(tile => {
            const tileVertices = [];
            for (let j = 0; j < 6; j++) {
                const vx = tile.x + HEX_RADIUS * Math.cos(cornerAngles[j]);
                const vy = tile.y + HEX_RADIUS * Math.sin(cornerAngles[j]);
                const vId = getOrCreateVertex(vx, vy, tile.id);
                tileVertices.push(vId);
            }

            tile.vertices = tileVertices;

            // Link vertices to form edges
            for (let j = 0; j < 6; j++) {
                const v1 = tileVertices[j];
                const v2 = tileVertices[(j + 1) % 6];
                const eId = getOrCreateEdge(v1, v2, tile.id);
                tile.edges.push(eId);
            }
        });

        // 4. Fill in adjacency references for vertices and edges
        edges.forEach(edge => {
            const v1 = vertices[edge.v1];
            const v2 = vertices[edge.v2];

            if (!v1.adjacentVertices.includes(edge.v2)) v1.adjacentVertices.push(edge.v2);
            if (!v1.adjacentEdges.includes(edge.id)) v1.adjacentEdges.push(edge.id);

            if (!v2.adjacentVertices.includes(edge.v1)) v2.adjacentVertices.push(edge.v1);
            if (!v2.adjacentEdges.includes(edge.id)) v2.adjacentEdges.push(edge.id);
        });

        // Populate edge adjacencies
        edges.forEach(edge => {
            const connectedEdges = [
                ...vertices[edge.v1].adjacentEdges.filter(id => id !== edge.id),
                ...vertices[edge.v2].adjacentEdges.filter(id => id !== edge.id)
            ];
            // Remove duplicates (though none should exist)
            edge.adjacentEdges = [...new Set(connectedEdges)];
        });

        // 5. Generate Harbors along the border
        // Find border vertices: those that have less than 3 adjacent tiles
        const borderVertices = vertices.filter(v => v.adjacentTiles.length < 3);

        // Sort border vertices angularly to trace the perimeter loop
        borderVertices.sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));

        // Placements: standard harbors spaced out.
        // There are exactly 30 border vertices forming a loop of 30 boundary edges.
        // We place harbors on 9 specific adjacent pairs.
        // Let's place harbors on boundary segments:
        const harborPlacements = [
            { startIdx: 0, type: HARBOR_TYPES.GENERIC },
            { startIdx: 3, type: HARBOR_TYPES.WOOD },
            { startIdx: 6, type: HARBOR_TYPES.GENERIC },
            { startIdx: 9, type: HARBOR_TYPES.BRICK },
            { startIdx: 13, type: HARBOR_TYPES.SHEEP },
            { startIdx: 16, type: HARBOR_TYPES.GENERIC },
            { startIdx: 20, type: HARBOR_TYPES.WHEAT },
            { startIdx: 23, type: HARBOR_TYPES.ORE },
            { startIdx: 26, type: HARBOR_TYPES.GENERIC }
        ];

        harborPlacements.forEach(placement => {
            const v1 = borderVertices[placement.startIdx];
            const v2 = borderVertices[(placement.startIdx + 1) % borderVertices.length];

            const harborInfo = {
                type: placement.type,
                v1: v1.id,
                v2: v2.id
            };

            v1.harbor = harborInfo;
            v2.harbor = harborInfo;
        });

        return {
            tiles,
            vertices,
            edges,
            robberTileId
        };
    }

    /**
     * Checks if a vertex is buildable for a player (settlement).
     */
    function isVertexBuildable(board, vertexId, playerId, isSetupPhase) {
        const vertex = board.vertices[vertexId];
        if (vertex.building !== null) return false;

        // Distance Rule: No building can be adjacent to another building
        for (const adjVId of vertex.adjacentVertices) {
            if (board.vertices[adjVId].building !== null) {
                return false;
            }
        }

        // Setup Phase: Can build anywhere that respects the Distance Rule
        if (isSetupPhase) {
            return true;
        }

        // Main Phase: Must connect to at least one of the player's roads
        let connectsToRoad = false;
        for (const edgeId of vertex.adjacentEdges) {
            if (board.edges[edgeId].road === playerId) {
                connectsToRoad = true;
                break;
            }
        }

        return connectsToRoad;
    }

    /**
     * Checks if a player can upgrade a settlement to a city.
     */
    function isVertexUpgradable(board, vertexId, playerId) {
        const vertex = board.vertices[vertexId];
        return (
            vertex.building !== null &&
            vertex.building.type === 'settlement' &&
            vertex.building.playerId === playerId
        );
    }

    /**
     * Checks if an edge is buildable for a player (road).
     */
    function isEdgeBuildable(board, edgeId, playerId, isSetupPhase, setupSettlementVertexId = null) {
        const edge = board.edges[edgeId];
        if (edge.road !== null) return false;

        // Setup Phase: Must connect directly to the newly placed settlement
        if (isSetupPhase) {
            return (edge.v1 === setupSettlementVertexId || edge.v2 === setupSettlementVertexId);
        }

        // Main Phase: Must connect to player's road or building,
        // and cannot connect through an opponent's blocking settlement/city.
        
        // Helper to check if a vertex is a valid connection node for player
        function canConnectThroughVertex(vId) {
            const v = board.vertices[vId];
            // If empty or belongs to us, we can connect through it
            if (v.building === null) return true;
            if (v.building.playerId === playerId) return true;
            // If belongs to opponent, it blocks our road continuation
            return false;
        }

        // Check if v1 connects to our roads/buildings
        let connectsV1 = false;
        if (canConnectThroughVertex(edge.v1)) {
            // Check if vertex has our building
            const v1 = board.vertices[edge.v1];
            if (v1.building !== null && v1.building.playerId === playerId) {
                connectsV1 = true;
            } else {
                // Check if vertex connects to another of our roads
                for (const adjEdgeId of v1.adjacentEdges) {
                    if (adjEdgeId !== edgeId && board.edges[adjEdgeId].road === playerId) {
                        connectsV1 = true;
                        break;
                    }
                }
            }
        }

        // Check if v2 connects to our roads/buildings
        let connectsV2 = false;
        if (canConnectThroughVertex(edge.v2)) {
            const v2 = board.vertices[edge.v2];
            if (v2.building !== null && v2.building.playerId === playerId) {
                connectsV2 = true;
            } else {
                for (const adjEdgeId of v2.adjacentEdges) {
                    if (adjEdgeId !== edgeId && board.edges[adjEdgeId].road === playerId) {
                        connectsV2 = true;
                        break;
                    }
                }
            }
        }

        return connectsV1 || connectsV2;
    }

    /**
     * Calculates the longest road for a player.
     * Implements DFS to find the longest contiguous path of roads.
     */
    function calculateLongestRoad(board, playerId) {
        let longest = 0;

        // Find all roads belonging to this player
        const playerRoads = board.edges.filter(e => e.road === playerId);
        if (playerRoads.length === 0) return 0;

        // We run a DFS starting from both endpoints of every road.
        // Since the network can be cyclic, we must track visited edges.
        const visitedEdges = new Set();

        function dfs(vId, currentLength) {
            let maxBranch = currentLength;

            // Find all unvisited roads connected to vId
            const vertex = board.vertices[vId];
            
            // Opponent buildings block road traversal
            if (vertex.building !== null && vertex.building.playerId !== playerId) {
                return currentLength;
            }

            for (const edgeId of vertex.adjacentEdges) {
                const edge = board.edges[edgeId];
                if (edge.road === playerId && !visitedEdges.has(edge.id)) {
                    visitedEdges.add(edge.id);
                    const nextVId = (edge.v1 === vId) ? edge.v2 : edge.v1;
                    const length = dfs(nextVId, currentLength + 1);
                    if (length > maxBranch) {
                        maxBranch = length;
                    }
                    visitedEdges.delete(edge.id);
                }
            }

            return maxBranch;
        }

        for (const road of playerRoads) {
            // Start DFS from both ends of the road
            visitedEdges.add(road.id);
            const len1 = dfs(road.v1, 1);
            const len2 = dfs(road.v2, 1);
            longest = Math.max(longest, len1, len2);
            visitedEdges.delete(road.id);
        }

        return longest;
    }

    return {
        HEX_RADIUS,
        RESOURCE_TYPES,
        HARBOR_TYPES,
        createBoard,
        isVertexBuildable,
        isVertexUpgradable,
        isEdgeBuildable,
        calculateLongestRoad
    };
})();
