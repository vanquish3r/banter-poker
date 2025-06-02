const { WebSocket } = require("@encharm/cws");
const express = require("express");
const http = require("http");
const path = require("path");
const deck = require("./deck");
const Hand = require("pokersolver").Hand;

class GameServer {
  constructor() {
    console.log("game starting...");
    this.setupServer();
    this.games = {};
  }

  setupServer() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ noServer: true });

    this.server.on("upgrade", (request, socket, head) => {
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit("connection", ws, request);
      });
    });

    this.wss.startAutoPing(10000);

    this.wss.on("connection", (ws, req) => {
      ws.on("message", (msg) => {
        try {
          if (msg !== "keepalive") {
            this.parseMessage(msg, ws);
          }
        } catch (e) {
          console.log("parse error: ", e);
        }
      });
      ws.on("close", (code, reason) => {
        this.handleClose(ws);
      });
    });

    this.app.use(express.static(path.join(__dirname, "public")));

    this.server.listen(3000, function listening() {
      console.log("game started");
    });
  }

  handleClose(ws) {
    const name = ws.u ? ws.u.name : "Unknown";
    console.log(name, "disconnected.");
    Object.keys(this.games).forEach((key) => {
      const game = this.games[key];
      if (ws.u && game.players[ws.u.id]) {
        game.players[ws.u.id].connected = false;
        game.players[ws.u.id].disconnectTime = new Date().getTime();
        console.log("Kicking in 2 mins...");
        game.players[ws.u.id].kickTimeout = setTimeout(() => {
          if (!game.players[ws.u.id].connected) {
            console.log(name, "kicked for inactivity.");
            this.removePlayer(ws);
          }
        }, 1000 * 60 * 2);
      }
      if (ws.u && game.waitingRoom.map((d) => d.id).indexOf(ws.u.id) > -1) {
        console.log(".. removed from waiting list.");
        game.waitingRoom = game.waitingRoom.filter((d) => d.id !== ws.u.id);
      }
    });
  }

  parseMessage(msg, ws) {
    let json = JSON.parse(msg);
    switch (json.path) {
      case "init":
        if (json.data.user) {
          ws.i = json.data.instance || "holy-shit";
          ws.u = json.data.user;
          const game = this.getOrCreateGame(ws);
          game.sockets[ws.u.id] = ws;
          if (game.players[ws.u.id]) {
            const name = ws.u ? ws.u.name : "Unknown";
            game.players[ws.u.id].connected = true;
            game.players[ws.u.id].disconnectTime = 0;
            if (game.players[ws.u.id].kickTimeout) {
              console.log(name, "returned within 2 mins, not kicked.");
              clearTimeout(game.players[ws.u.id].kickTimeout);
              game.players[ws.u.id].kickTimeout = null;
            }
          }
          this.syncGame(game);
          console.log(ws.u ? ws.u.name : "Unknown", "connected.");
        }
        break;
      case "join-game":
        this.joinGame(this.getOrCreateGame(ws), json, ws);
        break;
      case "start-game":
        this.startGame(ws);
        break;
      case "reset-game":
        const game = this.getOrCreateGame(ws);
        this.resetGame(ws, game, true);
        this.syncGame(game, null, true);
        break;
      case "check":
        this.check(ws);
        break;
      case "fold":
        this.fold(ws);
        break;
      case "bet":
        this.playerBet(ws, json.data);
        break;
    }
  }

  playerBet(ws, bet) {
    const game = this.getOrCreateGame(ws);
    if (game) {
      const player = game.players[ws.u.id];
      if (player) {
        const callAmount = Object.keys(game.players).reduce((a, b) => {
          const bet = game.players[b].bet;
          if (game.players[b].bet > a) {
            a = bet;
          }
          return a;
        }, 0);
        if (player.bet + bet >= callAmount) {
          this.bet(player, game, bet);
          player.hasBet = true;
          this.nextRound(ws, game);
        }
      }
    }
  }

  bet(player, game, bet, force) {
    if (this.playerIsCzar(player, game) || force) {
      player.bet += bet;
      player.chips -= bet;
      player.hasBet = true;
      Object.keys(game.players).forEach((p) => {
        if (game.players[p].bet < player.bet) {
          game.players[p].hasBet = false;
        }
      });
    }
  }

  check(ws) {
    const game = this.getOrCreateGame(ws);
    if (game) {
      const player = game.players[ws.u.id];
      if (
        player &&
        this.canCheck(game, player) &&
        this.playerIsCzar(player, game)
      ) {
        player.hasBet = true;
        this.nextRound(ws, game);
      }
    }
  }

  winner(game, player) {
    if (player && !player.hasFolded) {
      game.winner = player;
      setTimeout(() => {
        this.syncGame(game);
      }, 5000);
      this.playSound(game, "fanfare%20with%20pop.ogg");
    } else {
      console.error("Invalid winner attempt:", player);
    }
  }

  fold(ws) {
    const game = this.getOrCreateGame(ws);
    if (game) {
      const player = game.players[ws.u.id];
      if (player && this.playerIsCzar(player, game)) {
        player.hasFolded = true;
        player.lastHand = { descr: "-folded-" };
        const nonFoldedPlayers = Object.keys(game.players).filter(
          (p) => !game.players[p].hasFolded
        );

        if (nonFoldedPlayers.length === 1) {
          const winnings = Object.keys(game.players).reduce((a, b) => {
            a += game.players[b].bet;
            game.players[b].bet = 0; // Zero out player's bet after adding to winnings
            return a;
          }, 0);

          const winner = game.players[nonFoldedPlayers[0]];
          winner.chips += winnings;
          winner.lastHand = { descr: "All others folded" };
          this.winner(game, winner);
        }
        this.nextRound(ws, game);
      }
    }
  }

  removePlayer(ws, player) {
    const game = this.getOrCreateGame(ws);
    delete game.players[ws.u.id];
    this.startGame(ws);
  }

  resetDeck() {
    return Object.keys(deck)
      .slice()
      .sort(() => Math.random() - 0.5)
      .map((card) => ({ card, image: deck[card] }));
  }

  resetGame(ws, game, hardReset) {
    const players = Object.keys(game.players);
    players.forEach((p) => {
      game.players[p].bet = 0;
      game.players[p].cards = [];
      game.players[p].hasFolded = false;
      game.players[p].lastHand = null; // Clear last hand when resetting game
    });
    game.pots = [];
    game.tableCards = [];

    game.failedPlayers = [];
    game.winner = null;
    game.isStarted = false;
    game.deck = this.resetDeck();
    if (hardReset) {
      game.czar = "";
      game.players = {};
      game.waitingRoom = [];
    } else {
      this.nextCzar(game);
    }
  }

  nextCzar(game) {
    const players = Object.keys(game.players).filter(
      (p) => !game.players[p].hasFolded || p === game.czar
    );
    players.sort((a, b) => game.players[a].position - game.players[b].position);
    const currentCzarIndex = players.indexOf(game.czar);
    let nextCzarIndex = currentCzarIndex + 1;
    if (nextCzarIndex >= players.length) {
      nextCzarIndex = 0;
    }
    game.czar = players[nextCzarIndex];
  }

  startGame(ws) {
    const game = this.getOrCreateGame(ws);
    this.resetGame(ws, game);
    game.waitingRoom.forEach((d) => {
      this.createPlayer(d, game);
    });
    game.waitingRoom = [];
    var players = Object.keys(game.players);

    // Remove players that have gone bust
    players.forEach((d) => {
      const player = game.players[d];
      if (player.chips <= 0) { delete game.players[d]; }
    });
    players = Object.keys(game.players);

    if (players.length < 2) {
      this.syncGame(game);
      this.playSound(game, "playerJoin.ogg");
      return;
    }
    if (!game.czar) {
      game.czar = players[0];
    }
    game.startTime = new Date().getTime();
    players.forEach((d) => {
      const player = game.players[d];
      if (player.cards.length < 2) {
        for (let i = player.cards.length; i < 2; i++) {
          const card = game.deck.pop();
          player.cards.push(game.deck.pop(card));
        }
      }
      player.cards.length = 2;
      this.bet(player, game, game.blinds, true);
      player.hasBet = false;
    });
    game.isStarted = true;
    this.flop(game);
    this.playSound(game, "gameStart.ogg");
    this.syncGame(game);
  }

  playerIsCzar(player, game) {
    return game.czar === player._id;
  }

  riverTurn(game) {
    game.tableCards.push(game.deck.pop());
  }

  flop(game) {
    game.tableCards = [];
    this.riverTurn(game);
    this.riverTurn(game);
    this.riverTurn(game);
  }

  allHasBet(game, players) {
    return (
      players.filter((p) => game.players[p].hasBet).length === players.length
    );
  }

  canCheck(game, player) {
    const players = Object.keys(game.players);
    return !players.filter((p) => player.bet < game.players[p].bet).length;
  }

  nextRound(ws, game) {
    const players = Object.keys(game.players);
    const nonFoldedPlayers = players.filter((p) => !game.players[p].hasFolded);
    let allHasBet = this.allHasBet(game, nonFoldedPlayers);

    if (allHasBet) {
      players.forEach((p) => (game.players[p].hasBet = false));

      if (game.tableCards.length === 5) {
        // Evaluate hands for all players (including folded) for display purposes
        players.forEach((p) => {
          if (game.players[p].hasFolded) {
            game.players[p].lastHand = { descr: "-folded-" };
          } else {
            game.players[p].lastHand = Hand.solve(
              game.players[p].cards
                .map((c) => c.card)
                .concat(game.tableCards.map((c) => c.card))
            );
          }
        });

        // Only consider non-folded players for winning
        const activeHands = nonFoldedPlayers.map(
          (p) => game.players[p].lastHand
        );
        const winners = Hand.winners(activeHands);

        // Distribute winnings and declare winner
        if (winners.length > 0) {
          // Calculate winnings
          const winnings = players.reduce((a, b) => {
            a += game.players[b].bet;
            game.players[b].bet = 0; // Zero out player's bet after adding to winnings
            return a;
          }, 0);

          const firstWinnerId =
            nonFoldedPlayers[activeHands.indexOf(winners[0])];
          const firstWinner = game.players[firstWinnerId];
          
          // Distribute winnings to all winners
          // (seems to be an edge case where more than one player can have the same hand)
          winners.forEach((w) => {
            const winnerId = nonFoldedPlayers[activeHands.indexOf(w)];
            game.players[winnerId].chips += Math.floor(winnings / winners.length);
          });
          game.players[firstWinnerId].chips += (winnings % winners.length);  // First winner gets any left over chips, if not evenly divided amongst all winners

          this.winner(game, firstWinner);  // Only the first winner gets fan-fare, sorry!
        } else {
          // If no winners, all players keep their bets
          players.forEach((p) => {
            game.players[p].chips += game.players[p].bet;
            game.players[p].bet = 0; // Zero out player's bet after adding back to their chips
          });
        }
      } else {
        this.riverTurn(game);
        this.playSound(game, "card_flick.ogg");
      }
    }

    this.nextCzar(game);
    this.syncGame(game);
  }

  createPlayer(user, game) {
    game.players[user.id] = {
      _id: user.id,
      chips: 100,
      bet: 0,
      hasBet: false,
      hasFolded: false,
      cards: [],
      selected: [],
      name: user.name,
      position: this.getPosition(game),
      connected: true,
      disconnectTime: 0,
      lastHand: null,
    };
  }

  joinGame(game, json, ws) {
    if (Object.keys(game.players).length + game.waitingRoom.length > 9) {
      this.send(ws, "error", "This game is full, please try again later!");
      return;
    }
    if (game.isStarted) {
      if (!game.waitingRoom.filter((d) => d.id === ws.u.id).length) {
        game.waitingRoom.push(ws.u);
      }
    } else {
      if (game.players[ws.u.id]) {
        clearTimeout(game.players[ws.u.id].kickTimeout);
      }
      this.createPlayer(ws.u, game);
    }
    this.playSound(game, "playerJoin.ogg");
    this.syncGame(game);
  }

  playSound(game, sound) {
    Object.keys(game.sockets).forEach((socket) => {
      this.send(game.sockets[socket], "play-sound", sound);
    });
  }

  getOrCreateGame(ws) {
    let game = this.games[ws.i];
    if (!game) {
      game = this.games[ws.i] = {
        players: {},
        waitingRoom: [],
        czar: null,
        tableCards: [],
        startTime: 0,
        blinds: 1,
        pots: [],
        failedPlayers: [],
        deck: this.resetDeck(),
        isStarted: false,
        winner: null,
        sockets: {},
      };
    }
    return game;
  }

  getPosition(game) {
    const position = Math.floor(Math.random() * 8);
    if (
      Object.keys(game.players)
        .map((d) => game.players[d].position)
        .indexOf(position) > -1
    ) {
      return this.getPosition(game);
    } else {
      return position;
    }
  }

  send(socket, path, data) {
    socket.send(JSON.stringify({ path, data }));
  }

  syncGame(game, ws, isReset) {
    const {
      players,
      waitingRoom,
      czar,
      isStarted,
      winner,
      pots,
      blinds,
      tableCards,
    } = game;
    const playerIds = Object.keys(players);
    const _players = playerIds
      .map((d) => {
        const {
          _id,
          trophies,
          cards,
          selected,
          name,
          position,
          connected,
          disconnectTime,
          chips,
          bet,
          hasBet,
          hasFolded,
          lastHand,
        } = players[d];

        const canCheck = this.canCheck(game, players[d]);
        let _lastHand = null;
        if (lastHand) {
          const { descr, rank, cards, cardPool } = lastHand;
          _lastHand = { descr, rank, cards, cardPool };
        }
        return {
          _id,
          trophies,
          cards,
          selected,
          name,
          position,
          connected,
          disconnectTime,
          chips,
          bet,
          hasBet,
          hasFolded,
          lastHand: _lastHand,
          canCheck,
        };
      })
      .reduce((a, b) => {
        a[b._id] = b;
        return a;
      }, {});

    const playerCount = playerIds.length;
    if (ws) {
      this.send(ws, "sync-game", {
        players: _players,
        playerCount,
        waitingRoom,
        czar,
        isStarted,
        winner,
        pots,
        blinds,
        tableCards,
        isReset,
      });
    } else {
      Object.keys(game.sockets).forEach((socket) => {
        this.send(game.sockets[socket], "sync-game", {
          players: _players,
          playerCount,
          waitingRoom,
          czar,
          isStarted,
          winner,
          pots,
          blinds,
          tableCards,
          isReset,
        });
      });
    }
  }
}

const gameServer = new GameServer();
