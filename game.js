/**
 * game.js - Core State Machine, UI Renderer, and Event loop
 */

window.CatanGame = (function() {
    let state = {
        board: null,
        players: [],
        currentPlayerIdx: 0,
        phase: 'lobby',
        dice: [1, 1],
        devCardDeck: [],
        turnState: {
            hasRolled: false,
            devCardPlayedThisTurn: false,
            setupSettlementVertexId: null
        },
        gameLogs: [],
        longestRoadHolderId: null,
        largestArmyHolderId: null,
        pendingTradeOffer: null, // moved into state so it syncs to clients
        multiplayer: {
            active: false,
            role: null,
            myPlayerId: null
        }
    };

    // UI State
    let selectedBuildType = null;
    let selectedDevCardToPlay = null;
    let localPlayerName = "Player";

    // Turn Timer
    let turnTimerInterval = null;
    let turnTimerSeconds = 0;
    let lastTimerKey = null;

    function startTurnTimer(seconds) {
        clearTurnTimer();
        turnTimerSeconds = seconds;
        updateTimerDisplay(turnTimerSeconds);
        turnTimerInterval = setInterval(() => {
            turnTimerSeconds--;
            updateTimerDisplay(turnTimerSeconds);
            if (turnTimerSeconds <= 0) {
                clearTurnTimer();
                autoActOnTimeout();
            }
        }, 1000);
    }

    function clearTurnTimer() {
        if (turnTimerInterval) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
        updateTimerDisplay(null);
    }

    function updateTimerDisplay(seconds) {
        const el = document.getElementById('turn-timer');
        if (!el) return;
        if (seconds === null || seconds < 0) {
            el.style.display = 'none';
        } else {
            el.style.display = 'flex';
            el.textContent = seconds;
            el.className = 'turn-timer' + (seconds <= 3 ? ' urgent' : '');
        }
    }

    function autoActOnTimeout() {
        const activePlayer = state.players[state.currentPlayerIdx];
        if (!activePlayer || activePlayer.isAI) return;
        if (state.multiplayer.active && state.multiplayer.myPlayerId !== state.currentPlayerIdx) return;

        if (state.phase === 'roll') {
            reducer({ type: 'ROLL_DICE' });
        } else if (state.phase === 'setup_round_1_settlement' || state.phase === 'setup_round_2_settlement') {
            const vId = window.CatanAI.chooseSetupSettlement(state.board, activePlayer.id);
            reducer({ type: 'BUILD_SETTLEMENT', vertexId: vId });
        } else if (state.phase === 'setup_round_1_road' || state.phase === 'setup_round_2_road') {
            const eId = window.CatanAI.chooseSetupRoad(state.board, state.turnState.setupSettlementVertexId, activePlayer.id);
            reducer({ type: 'BUILD_ROAD', edgeId: eId });
        } else if (state.phase === 'robber_move') {
            const { tileId } = window.CatanAI.chooseRobberPlacement(state.board, activePlayer.id, state.players);
            reducer({ type: 'MOVE_ROBBER', tileId });
        } else if (state.phase === 'main') {
            reducer({ type: 'END_TURN' });
        }
    }

    function maybeStartTimer() {
        const activePlayer = state.players[state.currentPlayerIdx];
        if (!activePlayer || activePlayer.isAI || state.phase === 'game_over') return;
        if (state.multiplayer.active && state.multiplayer.myPlayerId !== state.currentPlayerIdx) { clearTurnTimer(); return; }

        const timedPhases = ['roll', 'main', 'robber_move',
            'setup_round_1_settlement', 'setup_round_1_road',
            'setup_round_2_settlement', 'setup_round_2_road'];
        if (!timedPhases.includes(state.phase)) { clearTurnTimer(); return; }

        const key = `${state.currentPlayerIdx}-${state.phase}`;
        if (key === lastTimerKey) return; // already ticking for this phase/player
        lastTimerKey = key;
        startTurnTimer(10);
    }

    // Colors for players
    const PLAYER_COLORS = ['#ff4b4b', '#4b75ff', '#ffb04b', '#4bff7e'];

    // Development Card Pool
    const DEV_CARDS = [
        ...Array(14).fill('knight'),
        ...Array(5).fill('victoryPoint'),
        ...Array(2).fill('roadBuilding'),
        ...Array(2).fill('yearOfPlenty'),
        ...Array(2).fill('monopoly')
    ];

    /**
     * Start a new game (AI or Pass-and-Play)
     */
    function initNewGame(mode, pNames, isAIList) {
        logMessage("Starting new game...");
        const randomize = true;
        state.board = window.CatanBoard.createBoard(randomize);

        state.players = pNames.map((name, idx) => ({
            id: idx,
            name: name,
            color: PLAYER_COLORS[idx],
            resources: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 },
            devCards: { knight: 0, victoryPoint: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 },
            playedKnights: 0,
            longestRoadLength: 0,
            victoryPoints: 0,
            isAI: isAIList[idx]
        }));

        state.currentPlayerIdx = 0;
        state.phase = 'setup_round_1_settlement';
        state.dice = [1, 1];
        state.devCardDeck = shuffle(DEV_CARDS);
        state.turnState = {
            hasRolled: false,
            devCardPlayedThisTurn: false,
            setupSettlementVertexId: null
        };
        state.gameLogs = [];
        state.longestRoadHolderId = null;
        state.largestArmyHolderId = null;
        state.pendingTradeOffer = null;
        state.multiplayer = { active: false, role: null, myPlayerId: null };
        lastTimerKey = null;

        logMessage("Setup Phase 1: Place your first settlement.");
        updateVP();
        render();

        // Check if first player is AI
        checkAILoop();
    }

    /**
     * Set state directly (used by clients to load host state)
     */
    function loadHostState(newState) {
        state = newState;
        lastTimerKey = null; // reset so timer restarts after state load
        render();
        if (state.phase !== 'game_over') {
            checkAILoop();
        }
    }

    function getState() {
        return state;
    }

    function setLocalPlayerInfo(name, id, role) {
        localPlayerName = name;
        state.multiplayer.active = true;
        state.multiplayer.role = role;
        state.multiplayer.myPlayerId = id;
    }

    // Helper: shuffle
    function shuffle(array) {
        const copy = [...array];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    function logMessage(msg) {
        state.gameLogs.push(msg);
        if (state.gameLogs.length > 50) state.gameLogs.shift();
    }

    /**
     * Recalculates VPs for all players.
     */
    function updateVP() {
        state.players.forEach(p => {
            let vp = 0;
            // 1 VP per settlement, 2 per city
            state.board.vertices.forEach(v => {
                if (v.building !== null && v.building.playerId === p.id) {
                    vp += (v.building.type === 'city') ? 2 : 1;
                }
            });
            // 1 VP per victoryPoint dev card
            vp += p.devCards.victoryPoint;
            // +2 VP for Longest Road
            if (state.longestRoadHolderId === p.id) vp += 2;
            // +2 VP for Largest Army
            if (state.largestArmyHolderId === p.id) vp += 2;

            p.victoryPoints = vp;
        });

        // Check winner
        const winner = state.players.find(p => p.victoryPoints >= 10);
        if (winner) {
            state.phase = 'game_over';
            logMessage(`🏆 GAME OVER! ${winner.name} wins with ${winner.victoryPoints} Victory Points!`);
        }
    }

    /**
     * Core Action Reducer. Updates game state.
     */
    function reducer(action) {
        if (state.phase === 'game_over') return;

        // Clear timer on any player action
        clearTurnTimer();
        lastTimerKey = null;

        // Redirect client actions to host in multiplayer
        if (state.multiplayer.active && state.multiplayer.role === 'client') {
            window.CatanNetwork.sendToHost({
                type: 'ACTION',
                action: action
            });
            return;
        }

        const activePlayer = state.players[state.currentPlayerIdx];

        // Ensure action is authorized in multiplayer
        if (state.multiplayer.active) {
            const myId = state.multiplayer.myPlayerId;
            // Exception: proposed trade response and discard actions can be done by non-active players
            const isMyTurn = (state.currentPlayerIdx === myId);
            const isDiscardPhase = (state.phase === 'robber_discard' && action.type === 'DISCARD_CARDS' && action.playerId === myId);
            const isTradeResponse = (state.phase === 'trade_proposing' && action.type === 'TRADE_RESPONSE' && action.playerId === myId);

            if (!isMyTurn && !isDiscardPhase && !isTradeResponse) {
                console.warn("Unauthorized action request ignored.");
                return;
            }
        }

        switch (action.type) {
            case 'ROLL_DICE':
                if (state.phase !== 'roll') return;
                state.dice = [Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1];
                const sum = state.dice[0] + state.dice[1];
                logMessage(`🎲 ${activePlayer.name} rolled a ${sum} (${state.dice[0]} + ${state.dice[1]})`);
                state.turnState.hasRolled = true;

                if (sum === 7) {
                    // Robber activated!
                    logMessage(`⚠️ Robber activated! Check for discards.`);
                    // Find players with > 7 cards
                    const discardsNeeded = {};
                    state.players.forEach(p => {
                        const totalCards = Object.values(p.resources).reduce((s, count) => s + count, 0);
                        if (totalCards > 7) {
                            discardsNeeded[p.id] = Math.floor(totalCards / 2);
                        }
                    });

                    if (Object.keys(discardsNeeded).length > 0) {
                        state.phase = 'robber_discard';
                        state.discardsNeeded = discardsNeeded;
                        logMessage(`Players must discard half their hand.`);
                    } else {
                        state.phase = 'robber_move';
                        logMessage(`${activePlayer.name}, move the robber.`);
                    }
                } else {
                    // Distribute resources
                    distributeResources(sum);
                    state.phase = 'main';
                }
                break;

            case 'BUILD_SETTLEMENT':
                if (state.phase !== 'setup_round_1_settlement' && 
                    state.phase !== 'setup_round_2_settlement' && 
                    state.phase !== 'main') return;

                const isSetup = state.phase.startsWith('setup');
                
                if (!window.CatanBoard.isVertexBuildable(state.board, action.vertexId, activePlayer.id, isSetup)) return;

                // Charge resources
                if (!isSetup) {
                    activePlayer.resources.wood--;
                    activePlayer.resources.brick--;
                    activePlayer.resources.sheep--;
                    activePlayer.resources.wheat--;
                }

                // Place building
                state.board.vertices[action.vertexId].building = {
                    type: 'settlement',
                    playerId: activePlayer.id
                };
                logMessage(`🏠 ${activePlayer.name} built a settlement.`);

                if (state.phase === 'setup_round_2_settlement') {
                    // Catan setup 2 starting resources
                    const vertex = state.board.vertices[action.vertexId];
                    vertex.adjacentTiles.forEach(tileId => {
                        const tile = state.board.tiles[tileId];
                        if (tile.resource !== 'desert') {
                            activePlayer.resources[tile.resource] = (activePlayer.resources[tile.resource] || 0) + 1;
                            logMessage(`🎁 ${activePlayer.name} received starting resource: ${tile.resource}`);
                        }
                    });
                }

                if (state.phase === 'setup_round_1_settlement') {
                    state.turnState.setupSettlementVertexId = action.vertexId;
                    state.phase = 'setup_round_1_road';
                } else if (state.phase === 'setup_round_2_settlement') {
                    state.turnState.setupSettlementVertexId = action.vertexId;
                    state.phase = 'setup_round_2_road';
                }
                updateVP();
                break;

            case 'BUILD_ROAD':
                if (state.phase !== 'setup_round_1_road' && 
                    state.phase !== 'setup_round_2_road' && 
                    state.phase !== 'main') return;

                const isRoadSetup = state.phase.startsWith('setup');
                const setupSettlement = state.turnState.setupSettlementVertexId;

                if (!window.CatanBoard.isEdgeBuildable(state.board, action.edgeId, activePlayer.id, isRoadSetup, setupSettlement)) return;

                // Charge resources
                if (!isRoadSetup) {
                    activePlayer.resources.wood--;
                    activePlayer.resources.brick--;
                }

                // Place road
                state.board.edges[action.edgeId].road = activePlayer.id;
                logMessage(`🛣️ ${activePlayer.name} built a road.`);

                // Recalculate Longest Road length
                activePlayer.longestRoadLength = window.CatanBoard.calculateLongestRoad(state.board, activePlayer.id);
                evaluateLongestRoad();

                if (state.phase === 'setup_round_1_road') {
                    state.turnState.setupSettlementVertexId = null;
                    advanceSetupTurn(1);
                } else if (state.phase === 'setup_round_2_road') {
                    state.turnState.setupSettlementVertexId = null;
                    advanceSetupTurn(2);
                }
                updateVP();
                break;

            case 'UPGRADE_CITY':
                if (state.phase !== 'main') return;
                if (!window.CatanBoard.isVertexUpgradable(state.board, action.vertexId, activePlayer.id)) return;

                activePlayer.resources.wheat -= 2;
                activePlayer.resources.ore -= 3;

                // Place city
                state.board.vertices[action.vertexId].building.type = 'city';
                logMessage(`🏰 ${activePlayer.name} upgraded a settlement to a City.`);
                updateVP();
                break;

            case 'BUY_DEV_CARD':
                if (state.phase !== 'main') return;
                if (state.devCardDeck.length === 0) return;

                activePlayer.resources.sheep--;
                activePlayer.resources.wheat--;
                activePlayer.resources.ore--;

                const card = state.devCardDeck.pop();
                activePlayer.devCards[card]++;
                logMessage(`🃏 ${activePlayer.name} bought a Development Card.`);
                updateVP();
                break;

            case 'PLAY_DEV_CARD':
                if (state.phase !== 'main') return;
                if (state.turnState.devCardPlayedThisTurn) return;
                if (activePlayer.devCards[action.card] <= 0) return;

                activePlayer.devCards[action.card]--;
                state.turnState.devCardPlayedThisTurn = true;

                if (action.card === 'knight') {
                    logMessage(`⚔️ ${activePlayer.name} played a Knight card! Move the robber.`);
                    state.phase = 'robber_move';
                } else if (action.card === 'roadBuilding') {
                    logMessage(`🛠️ ${activePlayer.name} played Road Building! (Gained resources for 2 roads)`);
                    activePlayer.resources.wood += 2;
                    activePlayer.resources.brick += 2;
                } else if (action.card === 'yearOfPlenty') {
                    logMessage(`🌾 ${activePlayer.name} played Year of Plenty! (Select 2 resources)`);
                    // Year of Plenty: just add chosen resources
                    activePlayer.resources[action.r1]++;
                    activePlayer.resources[action.r2]++;
                } else if (action.card === 'monopoly') {
                    logMessage(`💰 ${activePlayer.name} played Monopoly on ${action.resource}!`);
                    let stolenCount = 0;
                    state.players.forEach(p => {
                        if (p.id !== activePlayer.id) {
                            stolenCount += p.resources[action.resource] || 0;
                            p.resources[action.resource] = 0;
                        }
                    });
                    activePlayer.resources[action.resource] += stolenCount;
                    logMessage(`Stole ${stolenCount} ${action.resource} from opponents.`);
                }
                updateVP();
                break;

            case 'PLAY_KNIGHT': // Combined Dev Knight play + robber action
                if (state.phase !== 'main') return;
                if (state.turnState.devCardPlayedThisTurn) return;
                if (activePlayer.devCards.knight <= 0) return;

                activePlayer.devCards.knight--;
                state.turnState.devCardPlayedThisTurn = true;
                activePlayer.playedKnights++;
                evaluateLargestArmy();
                logMessage(`⚔️ ${activePlayer.name} played a Knight card!`);
                
                // Move robber and steal
                moveRobber(action.tileId);
                stealCard(action.tileId, action.stealPlayerId);
                updateVP();
                break;

            case 'MOVE_ROBBER':
                if (state.phase !== 'robber_move') return;
                if (action.tileId === state.board.robberTileId) return;

                moveRobber(action.tileId);
                
                // Check if there are players adjacent to steal from
                const stealTargets = getStealTargets(action.tileId);
                if (stealTargets.length > 0) {
                    state.phase = 'robber_steal';
                    state.robberTileTargetId = action.tileId;
                    logMessage(`Select a player to steal from.`);
                } else {
                    state.phase = 'main';
                }
                break;

            case 'STEAL_CARD':
                if (state.phase !== 'robber_steal') return;
                stealCard(state.robberTileTargetId, action.stealPlayerId);
                state.phase = 'main';
                state.robberTileTargetId = null;
                break;

            case 'DISCARD_CARDS':
                if (state.phase !== 'robber_discard') return;
                const pId = action.playerId;
                const discards = action.discards;

                // Validate and remove cards
                let totalDiscarded = 0;
                Object.keys(discards).forEach(res => {
                    const count = discards[res];
                    state.players[pId].resources[res] -= count;
                    totalDiscarded += count;
                });

                delete state.discardsNeeded[pId];
                logMessage(`💸 ${state.players[pId].name} discarded ${totalDiscarded} resources.`);

                if (Object.keys(state.discardsNeeded).length === 0) {
                    state.phase = 'robber_move';
                    logMessage(`${activePlayer.name}, move the robber.`);
                }
                break;

            case 'MARITIME_TRADE':
                if (state.phase !== 'main') return;
                activePlayer.resources[action.giveResource] -= action.count;
                activePlayer.resources[action.getResource]++;
                logMessage(`🔄 ${activePlayer.name} traded ${action.count} ${action.giveResource} for 1 ${action.getResource} with the harbor.`);
                break;

            case 'PROPOSE_TRADE':
                if (state.phase !== 'main') return;
                state.pendingTradeOffer = {
                    proposerId: activePlayer.id,
                    receiverId: action.receiverId,
                    offer: action.offer,
                    demand: action.demand
                };
                state.phase = 'trade_proposing';
                logMessage(`🤝 ${activePlayer.name} proposed a trade to ${state.players[action.receiverId].name}.`);
                break;

            case 'TRADE_RESPONSE':
                if (state.phase !== 'trade_proposing') return;
                if (action.accept) {
                    const proposer = state.players[state.pendingTradeOffer.proposerId];
                    const accepter = state.players[state.pendingTradeOffer.receiverId];

                    Object.keys(state.pendingTradeOffer.offer).forEach(res => {
                        const count = state.pendingTradeOffer.offer[res];
                        proposer.resources[res] -= count;
                        accepter.resources[res] += count;
                    });
                    Object.keys(state.pendingTradeOffer.demand).forEach(res => {
                        const count = state.pendingTradeOffer.demand[res];
                        accepter.resources[res] -= count;
                        proposer.resources[res] += count;
                    });

                    logMessage(`🤝 Trade accepted between ${proposer.name} and ${accepter.name}!`);
                } else {
                    logMessage(`❌ Trade declined.`);
                }
                state.pendingTradeOffer = null;
                state.phase = 'main';
                break;

            case 'END_TURN':
                if (state.phase !== 'main') return;
                state.currentPlayerIdx = (state.currentPlayerIdx + 1) % state.players.length;
                state.phase = 'roll';
                state.turnState.hasRolled = false;
                state.turnState.devCardPlayedThisTurn = false;
                logMessage(`➡️ Turn passed. It is now ${state.players[state.currentPlayerIdx].name}'s turn.`);
                break;
        }

        // Render local changes
        render();

        // Broadcast to clients if host
        if (state.multiplayer.active && state.multiplayer.role === 'host') {
            window.CatanNetwork.broadcast({ type: 'STATE_UPDATE', state: state });
        }

        // Trigger AI loop check if local or host
        if (!state.multiplayer.active || state.multiplayer.role === 'host') {
            if (state.phase !== 'game_over') {
                checkAILoop();
            }
        }
    }

    /**
     * Advance Turn order during the draft Setup phase (Snake Draft).
     * Order: P0 -> P1 -> P2 -> P3 -> P3 -> P2 -> P1 -> P0
     */
    function advanceSetupTurn(round) {
        const numPlayers = state.players.length;
        if (round === 1) {
            if (state.currentPlayerIdx === numPlayers - 1) {
                // Round 1 finished. Re-init setup 2 starting at P3 (same player index)
                state.phase = 'setup_round_2_settlement';
                logMessage(`Setup Phase 2: Place second settlement (order reversed).`);
            } else {
                state.currentPlayerIdx++;
                state.phase = 'setup_round_1_settlement';
                logMessage(`${state.players[state.currentPlayerIdx].name}, place settlement.`);
            }
        } else if (round === 2) {
            if (state.currentPlayerIdx === 0) {
                // Setup complete! Transition to first real turn
                state.phase = 'roll';
                logMessage(`Setup complete! Game begins. Roll the dice.`);
            } else {
                state.currentPlayerIdx--;
                state.phase = 'setup_round_2_settlement';
                logMessage(`${state.players[state.currentPlayerIdx].name}, place settlement.`);
            }
        }
    }

    /**
     * Distribute resources to players based on dice roll value.
     */
    function distributeResources(rollSum) {
        state.board.tiles.forEach(tile => {
            if (tile.number === rollSum && !tile.hasRobber) {
                tile.vertices.forEach(vId => {
                    const vertex = state.board.vertices[vId];
                    if (vertex.building !== null) {
                        const player = state.players[vertex.building.playerId];
                        const amount = (vertex.building.type === 'city') ? 2 : 1;
                        player.resources[tile.resource] += amount;
                        logMessage(`🎁 ${player.name} produced ${amount} ${tile.resource} from hex ${tile.id}.`);
                    }
                });
            }
        });
    }

    /**
     * Move Robber to selected tile.
     */
    function moveRobber(tileId) {
        state.board.tiles.forEach(t => t.hasRobber = false);
        state.board.tiles[tileId].hasRobber = true;
        state.board.robberTileId = tileId;
        logMessage(`⚠️ Robber moved to tile ${tileId} (${state.board.tiles[tileId].resource}).`);
    }

    /**
     * Steal a card from target player at robber tile.
     */
    function stealCard(tileId, stealPlayerId) {
        if (stealPlayerId === null || stealPlayerId === undefined) return;
        const target = state.players[stealPlayerId];
        const thief = state.players[state.currentPlayerIdx];

        // Gather all cards
        const hand = [];
        Object.keys(target.resources).forEach(res => {
            for (let i = 0; i < target.resources[res]; i++) {
                hand.push(res);
            }
        });

        if (hand.length > 0) {
            const stolen = hand[Math.floor(Math.random() * hand.length)];
            target.resources[stolen]--;
            thief.resources[stolen]++;
            logMessage(`🕵️ ${thief.name} stole a card from ${target.name}.`);
        } else {
            logMessage(`🕵️ ${target.name} has no cards to steal.`);
        }
    }

    /**
     * Finds players adjacent to robber tile who can be stolen from.
     */
    function getStealTargets(tileId) {
        const tile = state.board.tiles[tileId];
        const targets = new Set();
        tile.vertices.forEach(vId => {
            const v = state.board.vertices[vId];
            if (v.building !== null && v.building.playerId !== state.currentPlayerIdx) {
                // Ensure target has cards
                const targetPlayer = state.players[v.building.playerId];
                const cardsCount = Object.values(targetPlayer.resources).reduce((s, c) => s + c, 0);
                if (cardsCount > 0) {
                    targets.add(v.building.playerId);
                }
            }
        });
        return [...targets];
    }

    /**
     * Evaluate who holds the Longest Road card.
     */
    function evaluateLongestRoad() {
        let maxLen = 4; // minimum road length required is 5
        let holderId = state.longestRoadHolderId;

        state.players.forEach(p => {
            if (p.longestRoadLength > maxLen) {
                maxLen = p.longestRoadLength;
                holderId = p.id;
            }
        });

        if (holderId !== state.longestRoadHolderId) {
            state.longestRoadHolderId = holderId;
            const name = holderId !== null ? state.players[holderId].name : 'None';
            logMessage(`🏆 Longest Road card awarded to ${name} (${maxLen} roads)!`);
        }
    }

    /**
     * Evaluate who holds the Largest Army card.
     */
    function evaluateLargestArmy() {
        let maxKnights = 2; // minimum knights required is 3
        let holderId = state.largestArmyHolderId;

        state.players.forEach(p => {
            if (p.playedKnights > maxKnights) {
                maxKnights = p.playedKnights;
                holderId = p.id;
            }
        });

        if (holderId !== state.largestArmyHolderId) {
            state.largestArmyHolderId = holderId;
            const name = holderId !== null ? state.players[holderId].name : 'None';
            logMessage(`⚔️ Largest Army card awarded to ${name} (${maxKnights} knights played)!`);
        }
    }

    /**
     * Executes AI actions in a loop while it is an AI player's turn.
     */
    function checkAILoop() {
        const activePlayer = state.players[state.currentPlayerIdx];
        if (!activePlayer || !activePlayer.isAI) return;

        // Discard phase: AI discards immediately
        if (state.phase === 'robber_discard') {
            state.players.forEach(p => {
                if (p.isAI && state.discardsNeeded[p.id]) {
                    const discards = window.CatanAI.chooseDiscardCards(p.resources, state.discardsNeeded[p.id]);
                    setTimeout(() => {
                        reducer({ type: 'DISCARD_CARDS', playerId: p.id, discards });
                    }, 800);
                }
            });
            return;
        }

        // Other turns: delay AI action slightly to feel human
        setTimeout(() => {
            if (state.phase === 'setup_round_1_settlement' || state.phase === 'setup_round_2_settlement') {
                const vId = window.CatanAI.chooseSetupSettlement(state.board, activePlayer.id);
                reducer({ type: 'BUILD_SETTLEMENT', vertexId: vId });
            } else if (state.phase === 'setup_round_1_road' || state.phase === 'setup_round_2_road') {
                const roadEdgeId = window.CatanAI.chooseSetupRoad(state.board, state.turnState.setupSettlementVertexId, activePlayer.id);
                reducer({ type: 'BUILD_ROAD', edgeId: roadEdgeId });
            } else if (state.phase === 'roll') {
                reducer({ type: 'ROLL_DICE' });
            } else if (state.phase === 'robber_move') {
                const { tileId } = window.CatanAI.chooseRobberPlacement(state.board, activePlayer.id, state.players);
                reducer({ type: 'MOVE_ROBBER', tileId });
            } else if (state.phase === 'robber_steal') {
                const stealTargets = getStealTargets(state.robberTileTargetId);
                let targetId = stealTargets[0] !== undefined ? stealTargets[0] : null;
                reducer({ type: 'STEAL_CARD', stealPlayerId: targetId });
            } else if (state.phase === 'main') {
                const decision = window.CatanAI.makeTurnDecision(state, activePlayer.id);
                reducer(decision);
            }
        }, 1200);
    }

    /**
     * UI Rendering Engine. Updates HTML and SVG layers.
     */
    function render() {
        const activePlayer = state.players[state.currentPlayerIdx];
        if (!activePlayer) return;

        const myId = state.multiplayer.active ? state.multiplayer.myPlayerId : state.currentPlayerIdx;
        const myPlayer = state.players[myId] || activePlayer;

        // 1. Update Game Status Text
        const statusEl = document.getElementById('game-status-text');
        if (statusEl) {
            let phaseText = "";
            if (state.phase === 'setup_round_1_settlement' || state.phase === 'setup_round_2_settlement') {
                phaseText = `Setup: Place Settlement`;
            } else if (state.phase === 'setup_round_1_road' || state.phase === 'setup_round_2_road') {
                phaseText = `Setup: Place Road`;
            } else if (state.phase === 'roll') {
                phaseText = `Roll Phase`;
            } else if (state.phase === 'main') {
                phaseText = `Action Phase`;
            } else if (state.phase === 'robber_discard') {
                phaseText = `Discard Phase (7 Rolled)`;
            } else if (state.phase === 'robber_move') {
                phaseText = `Move Robber`;
            } else if (state.phase === 'robber_steal') {
                phaseText = `Robber Stealing`;
            } else if (state.phase === 'trade_proposing') {
                phaseText = `Trade Proposed`;
            } else if (state.phase === 'game_over') {
                phaseText = `🏆 Game Over!`;
            }

            statusEl.innerHTML = `<span style="color: ${activePlayer.color}">${activePlayer.name}</span> - ${phaseText}`;
        }

        // 2. Render Players Leaderboard
        const playersListEl = document.getElementById('players-leaderboard');
        if (playersListEl) {
            playersListEl.innerHTML = state.players.map(p => {
                const isCurrent = p.id === state.currentPlayerIdx ? 'active' : '';
                const totalCards = Object.values(p.resources).reduce((sum, v) => sum + v, 0);
                
                // Card details shown only for self OR in non-multiplayer
                let cardDetail = `🎴 ${totalCards}`;
                if (!state.multiplayer.active || p.id === myId) {
                    cardDetail = `<span class="res-mini-count">🌲${p.resources.wood} 🧱${p.resources.brick} 🐑${p.resources.sheep} 🌾${p.resources.wheat} 🪨${p.resources.ore}</span>`;
                }

                const specialCards = [];
                if (state.longestRoadHolderId === p.id) specialCards.push('🛣️ Longest Road');
                if (state.largestArmyHolderId === p.id) specialCards.push('⚔️ Largest Army');
                const specText = specialCards.length > 0 ? `<div class="p-specials">${specialCards.join(', ')}</div>` : '';

                return `
                    <div class="player-card ${isCurrent}" style="border-left: 5px solid ${p.color}">
                        <div class="p-header">
                            <span class="p-name">${p.name} ${p.isAI ? '(AI)' : ''}</span>
                            <span class="p-vp">${p.victoryPoints} VP</span>
                        </div>
                        <div class="p-stats">
                            ${cardDetail}
                            <span>⚔️ Knights: ${p.playedKnights}</span>
                        </div>
                        ${specText}
                    </div>
                `;
            }).join('');
        }

        // 3. Render Hand Resources
        const handResourcesEl = document.getElementById('hand-resources');
        if (handResourcesEl) {
            const res = myPlayer.resources;
            handResourcesEl.innerHTML = `
                <div class="resource-card wood">🌲<span>Wood: ${res.wood}</span></div>
                <div class="resource-card brick">🧱<span>Brick: ${res.brick}</span></div>
                <div class="resource-card sheep">🐑<span>Sheep: ${res.sheep}</span></div>
                <div class="resource-card wheat">🌾<span>Wheat: ${res.wheat}</span></div>
                <div class="resource-card ore">🪨<span>Ore: ${res.ore}</span></div>
            `;
        }

        // 4. Render Dev Cards Hand
        const devCardsEl = document.getElementById('hand-dev-cards');
        if (devCardsEl) {
            const cards = myPlayer.devCards;
            const list = [];
            if (cards.knight > 0) list.push(`<button class="dev-btn" onclick="CatanGame.selectDevCard('knight')">⚔️ Knight (${cards.knight})</button>`);
            if (cards.roadBuilding > 0) list.push(`<button class="dev-btn" onclick="CatanGame.selectDevCard('roadBuilding')">🛠️ Road Building (${cards.roadBuilding})</button>`);
            if (cards.yearOfPlenty > 0) list.push(`<button class="dev-btn" onclick="CatanGame.selectDevCard('yearOfPlenty')">🌾 Year of Plenty (${cards.yearOfPlenty})</button>`);
            if (cards.monopoly > 0) list.push(`<button class="dev-btn" onclick="CatanGame.selectDevCard('monopoly')">💰 Monopoly (${cards.monopoly})</button>`);
            if (cards.victoryPoint > 0) list.push(`<div class="dev-tag">🏆 Victory Point (+${cards.victoryPoint})</div>`);

            devCardsEl.innerHTML = list.length > 0 ? list.join('') : '<div class="no-dev">No usable development cards</div>';
        }

        // 5. Render Game Logs
        const logsEl = document.getElementById('game-logs');
        if (logsEl) {
            logsEl.innerHTML = state.gameLogs.map(log => `<div>${log}</div>`).join('');
            logsEl.scrollTop = logsEl.scrollHeight; // Auto scroll to bottom
        }

        // 6. Render Dice Values
        const dice1El = document.getElementById('dice-1');
        const dice2El = document.getElementById('dice-2');
        if (dice1El && dice2El) {
            dice1El.innerText = state.dice[0];
            dice2El.innerText = state.dice[1];
        }

        // 7. Render Game Controls (Disable/enable buttons based on status)
        const isMyTurn = (!state.multiplayer.active || state.multiplayer.myPlayerId === state.currentPlayerIdx);
        const canRoll = isMyTurn && state.phase === 'roll';
        const canBuild = isMyTurn && state.phase === 'main';

        const btnRoll = document.getElementById('btn-roll');
        if (btnRoll) btnRoll.disabled = !canRoll;

        // Dev card buy
        const btnBuyDev = document.getElementById('btn-buy-dev');
        if (btnBuyDev) {
            const hasRes = myPlayer.resources.sheep >= 1 && myPlayer.resources.wheat >= 1 && myPlayer.resources.ore >= 1;
            btnBuyDev.disabled = !canBuild || !hasRes || state.devCardDeckSize === 0;
        }

        // Build controls status active states
        const btnRoad = document.getElementById('btn-build-road');
        if (btnRoad) {
            const hasRes = myPlayer.resources.wood >= 1 && myPlayer.resources.brick >= 1;
            btnRoad.disabled = !canBuild || !hasRes;
            btnRoad.classList.toggle('selected', selectedBuildType === 'road');
        }

        const btnSettlement = document.getElementById('btn-build-settlement');
        if (btnSettlement) {
            const hasRes = myPlayer.resources.wood >= 1 && myPlayer.resources.brick >= 1 && myPlayer.resources.sheep >= 1 && myPlayer.resources.wheat >= 1;
            btnSettlement.disabled = !canBuild || !hasRes;
            btnSettlement.classList.toggle('selected', selectedBuildType === 'settlement');
        }

        const btnCity = document.getElementById('btn-build-city');
        if (btnCity) {
            const hasRes = myPlayer.resources.wheat >= 2 && myPlayer.resources.ore >= 3;
            btnCity.disabled = !canBuild || !hasRes;
            btnCity.classList.toggle('selected', selectedBuildType === 'city');
        }

        const btnTrade = document.getElementById('btn-trade-maritime');
        if (btnTrade) btnTrade.disabled = !canBuild;

        const btnEndTurn = document.getElementById('btn-end-turn');
        if (btnEndTurn) btnEndTurn.disabled = !isMyTurn || state.phase !== 'main';

        // Discard Modal Overlay
        const discardModal = document.getElementById('discard-modal');
        if (discardModal) {
            const discardRequired = state.phase === 'robber_discard' && state.discardsNeeded[myId] > 0;
            if (discardRequired) {
                discardModal.style.display = 'flex';
                document.getElementById('discard-count-req').innerText = state.discardsNeeded[myId];
                setupDiscardUI(myPlayer.resources, state.discardsNeeded[myId]);
            } else {
                discardModal.style.display = 'none';
            }
        }

        // Propose Trade Overlay
        const tradeModal = document.getElementById('trade-modal');
        if (tradeModal) {
            if (state.phase === 'trade_proposing' && state.pendingTradeOffer !== null) {
                const isReceiver = state.pendingTradeOffer.receiverId === myId;
                const isProposer = state.pendingTradeOffer.proposerId === myId;

                if (isReceiver) {
                    tradeModal.style.display = 'flex';
                    setupTradeReviewUI();
                } else if (isProposer) {
                    tradeModal.style.display = 'flex';
                    document.getElementById('trade-review-container').innerHTML = `<div class="trade-waiting">Waiting for opponent response...</div>`;
                } else {
                    tradeModal.style.display = 'none';
                }
            } else {
                tradeModal.style.display = 'none';
            }
        }

        // 8. Render SVG Board
        renderBoard(myId);

        // 9. Start timer for human player turns
        maybeStartTimer();
    }

    /**
     * Renders the interactive board SVG
     */
    function renderBoard(myId) {
        const svg = document.getElementById('board-svg');
        if (!svg) return;

        // Clear existing SVG
        svg.innerHTML = '';

        // Add definitions for textures/gradients if needed
        const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        defs.innerHTML = `
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
        `;
        svg.appendChild(defs);

        // 1. Draw tiles
        state.board.tiles.forEach(tile => {
            const points = tile.vertices.map(vId => {
                const v = state.board.vertices[vId];
                return `${v.x},${v.y}`;
            }).join(' ');

            const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
            polygon.setAttribute("points", points);
            polygon.setAttribute("class", `tile ${tile.resource}`);
            polygon.setAttribute("data-tile-id", tile.id);

            // Robber Click Selection
            const isMyTurn = (!state.multiplayer.active || state.multiplayer.myPlayerId === state.currentPlayerIdx);
            if (isMyTurn && state.phase === 'robber_move') {
                if (tile.id !== state.board.robberTileId && tile.resource !== 'desert') {
                    polygon.classList.add('robber-target');
                    polygon.onclick = () => {
                        reducer({ type: 'MOVE_ROBBER', tileId: tile.id });
                    };
                }
            }

            svg.appendChild(polygon);

            // Draw tile number token (if not desert)
            if (tile.resource !== 'desert') {
                const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                circle.setAttribute("cx", tile.x);
                circle.setAttribute("cy", tile.y);
                circle.setAttribute("r", 20);
                circle.setAttribute("class", "num-token");
                svg.appendChild(circle);

                const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                text.setAttribute("x", tile.x);
                text.setAttribute("y", tile.y + 6);
                text.setAttribute("text-anchor", "middle");
                text.setAttribute("class", `num-value ${ (tile.number === 6 || tile.number === 8) ? 'red' : '' }`);
                text.textContent = tile.number;
                svg.appendChild(text);

                // Probability dots
                const dots = window.CatanAI.makeTurnDecision ? getDotsCount(tile.number) : 0;
                const dotText = document.createElementNS("http://www.w3.org/2000/svg", "text");
                dotText.setAttribute("x", tile.x);
                dotText.setAttribute("y", tile.y + 16);
                dotText.setAttribute("text-anchor", "middle");
                dotText.setAttribute("class", "num-dots");
                dotText.textContent = "•".repeat(dots);
                svg.appendChild(dotText);
            }

            // Draw robber marker if exists
            if (tile.hasRobber) {
                const rob = document.createElementNS("http://www.w3.org/2000/svg", "g");
                rob.innerHTML = `
                    <circle cx="${tile.x}" cy="${tile.y - 5}" r="12" fill="#2d2d2d" stroke="#ff4b4b" stroke-width="1.5" />
                    <rect x="${tile.x - 6}" y="${tile.y + 5}" width="12" height="15" fill="#2d2d2d" stroke="#ff4b4b" stroke-width="1.5" rx="3" />
                `;
                svg.appendChild(rob);
            }
        });

        // 2. Draw harbors
        const renderedHarbors = new Set();
        state.board.vertices.forEach(v => {
            if (v.harbor !== null && !renderedHarbors.has(v.harbor)) {
                renderedHarbors.add(v.harbor);
                const h = v.harbor;
                const v1 = state.board.vertices[h.v1];
                const v2 = state.board.vertices[h.v2];

                // Math to place harbor label slightly outside the board center (0,0)
                const mx = (v1.x + v2.x) / 2;
                const my = (v1.y + v2.y) / 2;
                const len = Math.hypot(mx, my);
                const hx = mx + (mx / len) * 25;
                const hy = my + (my / len) * 25;

                // Draw harbor bridge lines
                const l1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
                l1.setAttribute("x1", hx); l1.setAttribute("y1", hy);
                l1.setAttribute("x2", v1.x); l1.setAttribute("y2", v1.y);
                l1.setAttribute("class", "harbor-line");
                svg.appendChild(l1);

                const l2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
                l2.setAttribute("x1", hx); l2.setAttribute("y1", hy);
                l2.setAttribute("x2", v2.x); l2.setAttribute("y2", v2.y);
                l2.setAttribute("class", "harbor-line");
                svg.appendChild(l2);

                // Draw label circle
                const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                c.setAttribute("cx", hx);
                c.setAttribute("cy", hy);
                c.setAttribute("r", 14);
                c.setAttribute("class", `harbor-badge ${h.type}`);
                svg.appendChild(c);

                const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
                t.setAttribute("x", hx);
                t.setAttribute("y", hy + 4);
                t.setAttribute("text-anchor", "middle");
                t.setAttribute("class", "harbor-text");
                t.textContent = h.type === '3:1' ? '3:1' : getResourceSymbol(h.type);
                svg.appendChild(t);
            }
        });

        // 3. Draw roads
        state.board.edges.forEach(edge => {
            if (edge.road !== null) {
                const v1 = state.board.vertices[edge.v1];
                const v2 = state.board.vertices[edge.v2];
                const owner = state.players[edge.road];

                const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                line.setAttribute("x1", v1.x); line.setAttribute("y1", v1.y);
                line.setAttribute("x2", v2.x); line.setAttribute("y2", v2.y);
                line.setAttribute("class", "road-placed");
                line.setAttribute("stroke", owner.color);
                svg.appendChild(line);
            }
        });

        // 4. Draw interactive overlay for roads build selection
        const isMyTurn = (!state.multiplayer.active || state.multiplayer.myPlayerId === state.currentPlayerIdx);
        const isRoadMode = selectedBuildType === 'road';
        const isSetupRoadPhase = state.phase === 'setup_round_1_road' || state.phase === 'setup_round_2_road';

        if (isMyTurn && (isRoadMode || isSetupRoadPhase)) {
            const setupSettlement = state.turnState.setupSettlementVertexId;
            state.board.edges.forEach(edge => {
                if (window.CatanBoard.isEdgeBuildable(state.board, edge.id, myId, isSetupRoadPhase, setupSettlement)) {
                    const v1 = state.board.vertices[edge.v1];
                    const v2 = state.board.vertices[edge.v2];

                    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                    line.setAttribute("x1", v1.x); line.setAttribute("y1", v1.y);
                    line.setAttribute("x2", v2.x); line.setAttribute("y2", v2.y);
                    line.setAttribute("class", "road-helper");
                    line.onclick = () => {
                        selectedBuildType = null;
                        reducer({ type: 'BUILD_ROAD', edgeId: edge.id });
                    };
                    svg.appendChild(line);
                }
            });
        }

        // 5. Draw settlements and cities
        state.board.vertices.forEach(v => {
            if (v.building !== null) {
                const owner = state.players[v.building.playerId];
                
                if (v.building.type === 'settlement') {
                    // Draw house shape
                    const house = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
                    house.setAttribute("points", `${v.x},${v.y-8} ${v.x+8},${v.y} ${v.x+5},${v.y} ${v.x+5},${v.y+8} ${v.x-5},${v.y+8} ${v.x-5},${v.y} ${v.x-8},${v.y}`);
                    house.setAttribute("class", "settlement-placed");
                    house.setAttribute("fill", owner.color);
                    svg.appendChild(house);
                } else if (v.building.type === 'city') {
                    // Draw castle/city shape
                    const castle = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
                    castle.setAttribute("points", `${v.x-8},${v.y-8} ${v.x-8},${v.y+8} ${v.x+10},${v.y+8} ${v.x+10},${v.y-2} ${v.x+2},${v.y-2} ${v.x+2},${v.y-8} ${v.x-3},${v.y-4}`);
                    castle.setAttribute("class", "city-placed");
                    castle.setAttribute("fill", owner.color);
                    svg.appendChild(castle);
                }
            }
        });

        // 6. Draw interactive overlay circles for settlements or cities build selection
        const isSettlementMode = selectedBuildType === 'settlement';
        const isSetupSettlementPhase = state.phase === 'setup_round_1_settlement' || state.phase === 'setup_round_2_settlement';
        const isCityMode = selectedBuildType === 'city';

        if (isMyTurn) {
            state.board.vertices.forEach(v => {
                if (isCityMode) {
                    // Show valid upgrade spots
                    if (window.CatanBoard.isVertexUpgradable(state.board, v.id, myId)) {
                        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                        circle.setAttribute("cx", v.x);
                        circle.setAttribute("cy", v.y);
                        circle.setAttribute("r", 10);
                        circle.setAttribute("class", "upgrade-helper");
                        circle.onclick = () => {
                            selectedBuildType = null;
                            reducer({ type: 'UPGRADE_CITY', vertexId: v.id });
                        };
                        svg.appendChild(circle);
                    }
                } else if (isSettlementMode || isSetupSettlementPhase) {
                    // Show valid build spots
                    if (window.CatanBoard.isVertexBuildable(state.board, v.id, myId, isSetupSettlementPhase)) {
                        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                        circle.setAttribute("cx", v.x);
                        circle.setAttribute("cy", v.y);
                        circle.setAttribute("r", 8);
                        circle.setAttribute("class", "build-helper");
                        circle.onclick = () => {
                            selectedBuildType = null;
                            reducer({ type: 'BUILD_SETTLEMENT', vertexId: v.id });
                        };
                        svg.appendChild(circle);
                    }
                }
            });
        }

        // 7. Draw robber target overlays (stealing selection)
        if (isMyTurn && state.phase === 'robber_steal' && state.robberTileTargetId !== null) {
            const stealTargets = getStealTargets(state.robberTileTargetId);
            state.board.vertices.forEach(v => {
                if (v.building !== null && stealTargets.includes(v.building.playerId)) {
                    // Highlight the players' buildings that can be stolen from
                    const highlight = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                    highlight.setAttribute("cx", v.x);
                    highlight.setAttribute("cy", v.y);
                    highlight.setAttribute("r", 16);
                    highlight.setAttribute("class", "steal-target-helper");
                    highlight.onclick = () => {
                        reducer({ type: 'STEAL_CARD', stealPlayerId: v.building.playerId });
                    };
                    svg.appendChild(highlight);
                }
            });
        }
    }

    // Helper: translate resource strings to unicode emoji icons
    function getResourceSymbol(res) {
        switch (res) {
            case 'wood': return '🌲';
            case 'brick': return '🧱';
            case 'sheep': return '🐑';
            case 'wheat': return '🌾';
            case 'ore': return '🪨';
        }
        return '';
    }

    // Helper: get dice dots count
    function getDotsCount(num) {
        const dotsMap = { 2: 1, 12: 1, 3: 2, 11: 2, 4: 3, 10: 3, 5: 4, 9: 4, 6: 5, 8: 5 };
        return dotsMap[num] || 0;
    }

    /**
     * UI Click Handler: Select build action
     */
    function selectBuildAction(type) {
        if (selectedBuildType === type) {
            selectedBuildType = null; // Toggle off
        } else {
            selectedBuildType = type;
        }
        render();
    }

    /**
     * UI Click Handler: Select Dev Card
     */
    function selectDevCard(card) {
        if (state.phase !== 'main') return;
        selectedDevCardToPlay = card;

        if (card === 'knight') {
            reducer({ type: 'PLAY_DEV_CARD', card });
        } else if (card === 'roadBuilding') {
            reducer({ type: 'PLAY_DEV_CARD', card });
        } else if (card === 'yearOfPlenty') {
            // Open simple resource pick modal
            const r1 = prompt("Enter first resource (wood, brick, sheep, wheat, ore):", "wood");
            const r2 = prompt("Enter second resource (wood, brick, sheep, wheat, ore):", "wheat");
            if (['wood','brick','sheep','wheat','ore'].includes(r1) && ['wood','brick','sheep','wheat','ore'].includes(r2)) {
                reducer({ type: 'PLAY_DEV_CARD', card, r1, r2 });
            }
        } else if (card === 'monopoly') {
            const res = prompt("Enter resource type to monopolize (wood, brick, sheep, wheat, ore):", "sheep");
            if (['wood','brick','sheep','wheat','ore'].includes(res)) {
                reducer({ type: 'PLAY_DEV_CARD', card, resource: res });
            }
        }
    }

    /**
     * Set up maritime/harbor trade UI and triggering trade action.
     */
    function triggerMaritimeTrade() {
        const rates = window.CatanAI.makeTurnDecision ? getTradeRates(state.board, state.currentPlayerIdx) : { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };
        const myPlayer = state.players[state.currentPlayerIdx];

        // Format dialog rates message
        const rateMessage = Object.keys(rates).map(res => `${res}: ${rates[res]}:1`).join('\n');
        const give = prompt(`Choose resource to trade away:\n${rateMessage}`, "wood");
        const get = prompt(`Choose resource to receive:\n(wood, brick, sheep, wheat, ore)`, "wheat");

        if (rates[give] && ['wood','brick','sheep','wheat','ore'].includes(get)) {
            const cost = rates[give];
            if (myPlayer.resources[give] >= cost) {
                reducer({ type: 'MARITIME_TRADE', giveResource: give, getResource: get, count: cost });
            } else {
                alert(`Insufficient resource. You need at least ${cost} ${give} to complete this trade.`);
            }
        }
    }

    /**
     * UI Click Handler: Open Player Trade Offer Overlay
     */
    function proposePlayerTrade() {
        const playersOptions = state.players
            .filter(p => p.id !== state.currentPlayerIdx && !p.isAI)
            .map(p => `${p.id}: ${p.name}`)
            .join('\n');

        if (playersOptions.length === 0) {
            alert("No available human players to trade with.");
            return;
        }

        const receiverId = prompt(`Enter opponent player ID to trade with:\n${playersOptions}`, "");
        if (receiverId === null || receiverId === "") return;

        const recId = parseInt(receiverId);
        if (isNaN(recId) || !state.players[recId] || state.players[recId].isAI) {
            alert("Invalid player ID selection.");
            return;
        }

        const giveRes = prompt("Enter resource to offer (wood, brick, sheep, wheat, ore):", "wood");
        const giveCount = parseInt(prompt("Enter amount to offer:", "1"));
        const getRes = prompt("Enter resource to demand (wood, brick, sheep, wheat, ore):", "wheat");
        const getCount = parseInt(prompt("Enter amount to demand:", "1"));

        if (!['wood','brick','sheep','wheat','ore'].includes(giveRes) ||
            !['wood','brick','sheep','wheat','ore'].includes(getRes) ||
            isNaN(giveCount) || isNaN(getCount) || giveCount <= 0 || getCount <= 0) {
            alert("Invalid resource trade inputs.");
            return;
        }

        // Validate proposer has offered resources
        const myPlayer = state.players[state.currentPlayerIdx];
        if ((myPlayer.resources[giveRes] || 0) < giveCount) {
            alert("You do not have enough resources to make this offer.");
            return;
        }

        const offer = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
        const demand = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
        offer[giveRes] = giveCount;
        demand[getRes] = getCount;

        reducer({
            type: 'PROPOSE_TRADE',
            receiverId: recId,
            offer: offer,
            demand: demand
        });
    }

    /**
     * Renders trade proposal details for reviewer.
     */
    function setupTradeReviewUI() {
        const container = document.getElementById('trade-review-container');
        if (!container) return;

        const proposer = state.players[state.pendingTradeOffer.proposerId];
        const offerStr = Object.keys(state.pendingTradeOffer.offer).filter(k => state.pendingTradeOffer.offer[k] > 0).map(k => `${state.pendingTradeOffer.offer[k]} ${k}`).join(', ');
        const demandStr = Object.keys(state.pendingTradeOffer.demand).filter(k => state.pendingTradeOffer.demand[k] > 0).map(k => `${state.pendingTradeOffer.demand[k]} ${k}`).join(', ');

        const myId = state.multiplayer.active ? state.multiplayer.myPlayerId : state.currentPlayerIdx;
        const myPlayer = state.players[myId];
        let hasEnough = true;
        Object.keys(state.pendingTradeOffer.demand).forEach(res => {
            if (myPlayer.resources[res] < state.pendingTradeOffer.demand[res]) {
                hasEnough = false;
            }
        });

        container.innerHTML = `
            <div class="trade-review-title">Incoming Trade Proposal</div>
            <div class="trade-review-body">
                <strong>${proposer.name}</strong> offers: <span class="trade-res-offer">${offerStr}</span><br/>
                In exchange for your: <span class="trade-res-demand">${demandStr}</span>
            </div>
            <div class="trade-review-actions">
                <button class="trade-act-btn accept" onclick="CatanGame.respondToTrade(true)" ${hasEnough ? '' : 'disabled'}>Accept Trade</button>
                <button class="trade-act-btn decline" onclick="CatanGame.respondToTrade(false)">Decline</button>
            </div>
            ${hasEnough ? '' : '<div class="trade-warning-msg">You do not have the requested resources to accept.</div>'}
        `;
    }

    function respondToTrade(accept) {
        const myId = state.multiplayer.active ? state.multiplayer.myPlayerId : state.currentPlayerIdx;
        // Pipe client action to host in multiplayer
        if (state.multiplayer.active && state.multiplayer.role === 'client') {
            window.CatanNetwork.sendToHost({
                type: 'ACTION',
                action: { type: 'TRADE_RESPONSE', playerId: myId, accept: accept }
            });
        } else {
            reducer({ type: 'TRADE_RESPONSE', playerId: myId, accept: accept });
        }
    }

    /**
     * Renders card discard counters UI.
     */
    function setupDiscardUI(resources, discardCount) {
        const container = document.getElementById('discard-resource-selectors');
        if (!container) return;

        let selectedDiscards = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
        let countSelected = 0;

        function renderSelectors() {
            container.innerHTML = Object.keys(resources).map(res => {
                const available = resources[res] || 0;
                const selected = selectedDiscards[res];

                return `
                    <div class="discard-res-row">
                        <span class="discard-res-label">${getResourceSymbol(res)} ${res.toUpperCase()} (${available})</span>
                        <div class="discard-res-controls">
                            <button class="discard-ctrl" onclick="CatanGame.adjustDiscard('${res}', -1)" ${selected === 0 ? 'disabled' : ''}>-</button>
                            <span class="discard-val">${selected}</span>
                            <button class="discard-ctrl" onclick="CatanGame.adjustDiscard('${res}', 1)" ${selected === available || countSelected === discardCount ? 'disabled' : ''}>+</button>
                        </div>
                    </div>
                `;
            }).join('');

            const submitBtn = document.getElementById('btn-submit-discard');
            if (submitBtn) {
                submitBtn.disabled = (countSelected !== discardCount);
            }
        }

        // Global functions hook to let UI interact
        window.CatanGame.adjustDiscard = (res, delta) => {
            selectedDiscards[res] += delta;
            countSelected += delta;
            renderSelectors();
        };

        window.CatanGame.submitDiscard = () => {
            const myId = state.multiplayer.active ? state.multiplayer.myPlayerId : state.currentPlayerIdx;
            if (state.multiplayer.active && state.multiplayer.role === 'client') {
                window.CatanNetwork.sendToHost({
                    type: 'ACTION',
                    action: { type: 'DISCARD_CARDS', playerId: myId, discards: selectedDiscards }
                });
            } else {
                reducer({ type: 'DISCARD_CARDS', playerId: myId, discards: selectedDiscards });
            }
        };

        renderSelectors();
    }

    return {
        initNewGame,
        loadHostState,
        getState,
        setLocalPlayerInfo,
        reducer,
        selectBuildAction,
        selectDevCard,
        triggerMaritimeTrade,
        proposePlayerTrade,
        respondToTrade,
        render
    };
})();
