const pokerCurrentScript = Array.from(document.getElementsByTagName('script')).slice(-1)[0];
class PokerGameSystem {
  constructor(){
    this.init();
  }
  async init() {
    this.hostUrl = 'banter-poker.glitch.me';
    this.currentScript = pokerCurrentScript;
    this.urlParams = new URLSearchParams(window.location.search);
    this.parseParams();
    this.tempBet = 0;
    if(window.isBanter) {
      await window.AframeInjection.waitFor(window, 'user');
      await window.AframeInjection.waitFor(window, 'banterLoaded');
    }
    this.scene = document.querySelector("a-scene");
    if(!this.scene){
      return;
    }
    if(!window.user) {
      this.generateGuestUser();
    }
    this.parent = this.getTableHTML();
    await this.wait(1);
    await this.setupTable();
    await this.setupWebsocket();
    await this.wait(1);
    this.parent.setAttribute("scale", "1 1 1");
    await this.wait(1);
    this.initialWait = true;
  }
  wait(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }
  parseParams() {
    this.setOrDefault("position", "0 0 0");
    this.setOrDefault("rotation", "0 0 0");
    this.setOrDefault("uid", null);
    this.setOrDefault("instance", "demo-game");
    this.setOrDefault("debug", "false");
    this.setOrDefault("one-for-each-instance", "false");
    if(this.params["one-for-each-instance"] === "true" && window.user && window.user.instance) {
      this.params.instance += window.user.instance;
    }
  }
  setOrDefault(attr, defaultValue) {
    const value = this.currentScript.getAttribute(attr);
    this.params = this.params || {};
    this.params[attr] = value || (this.urlParams.has(attr) ? this.urlParams.get(attr) : defaultValue);
  }
  setupWebsocket(){
    return new Promise(resolve => {
      this.ws = new WebSocket('wss://banter-poker.glitch.me/');
      this.ws.onopen = async (event) => {
        const instance = this.params.instance;
        const user = window.user;
        this.send("init", {instance, user});
        console.log("Connected to game server.")
        resolve();
      };
      this.ws.onmessage = (event) => {
        if(typeof event.data === 'string'){
          this.parseMessage(event.data);
        }
      }
      this.ws.onclose =  (event) => {
        console.log("Connection to game server closed, reconnecting...")
        setTimeout(() => {
          this.setupWebsocket();
        }, 1000);
      };
    });
  }
  setupTable() {
    this.startCard = this.parent.querySelector("._startCard");
    this.gameCard = this.parent.querySelector("._gameCard");
    this.mainCTAJoinText = this.parent.querySelector("._clickToJoin");
    this.mainCTAJoinButton = this.parent.querySelector("._clickToJoinButton");
    this.resetGameEle = this.parent.querySelector(".resetGame");
    this.betButton = this.parent.querySelector("._betOption");
    this.foldButton = this.parent.querySelector("._foldOption");
    this.checkButton = this.parent.querySelector("._checkOption");
    this.currentGameState = this.parent.querySelector("._currentGameState");
    this.betUi = this.parent.querySelector(".betUi");
    this.setupBetUi();
    
    this.resetGameEle.addEventListener('click', () => {
      this.send("reset-game");
      this.resetGame();
    });
    this.mainCTAJoinButton.addEventListener('click', () => {
      if(this.canStart){
        this.send('start-game');
        console.log("Starting game...");
      }else{
        this.send('join-game');
        console.log("Joining game...");
      }
    });
    
    this.betButton.addEventListener("click", this.debounce(() => {
      const callAmount = this.getCallAmount();
      if(callAmount) {
        this._callButtonText.setAttribute("visible", true);
        this._callButton.setAttribute("visible", true);
        this.setText(this._callButtonText, "Call " + callAmount);
      }else{
        this._callButton.setAttribute("visible", false);
        this._callButtonText.setAttribute("visible", false);
      }
      this.betUi.setAttribute("visible", true);
    }))
    
    this.checkButton.addEventListener("click", this.debounce(() => {
      this.send("check");
    }));
    
    this.foldButton.addEventListener("click", this.debounce(() => {
      this.send("fold");
    }));
    
    if(window.isBanter) {
      Array.from(this.parent.querySelector("[look-at]")).forEach(ele => {
        ele.removeAttribute("look-at");
      });
    }
  }
  setTempBetText() {
    if(this.currentPlayerSection && this.currentPlayer) {
      this.setText(this.currentPlayerSection.querySelector("._betAmount"), "Bet:" + (this.currentPlayer.bet + this.tempBet));
      this.setText(this.currentPlayerSection.querySelector("._coinsAmount"), this.currentPlayer.chips - this.tempBet);
    }
  }
  correctTempBet() {
    if(this.tempBet < 0) {
      this.tempBet = 0;
    }
    if(this.tempBet > this.currentPlayer.chips) {
      this.tempBet = this.currentPlayer.chips;
    }
  }
  setTempBet(bet) {
    if(this.currentPlayerSection && this.currentPlayer) {
      this.tempBet += bet;
      this.correctTempBet();
      this.setTempBetText();
    }
  }
  getCallAmount() {
    return this.currentPlayer ? Object.keys(this.currentGame.players).reduce((a,b) => {
      const bet = this.currentGame.players[b].bet;
      if(this.currentGame.players[b].bet > a) {
        a = bet
      }
      return a;
    },0) - this.currentPlayer.bet : 0;
  }
  call() {
    this.tempBet = this.callAmount;
    this.correctTempBet();
    this.setTempBetText();
    this.send("bet", this.tempBet);
  }
  setupBetUi() {
    const _betAddOneButton = this.parent.querySelector("._betAddOneButton");
    const _betAddFiveButton = this.parent.querySelector("._betAddFiveButton");
    const _betSubOneButton = this.parent.querySelector("._betSubOneButton");
    const _betSubFiveButton = this.parent.querySelector("._betSubFiveButton");
    _betAddOneButton.addEventListener("click", () => this.setTempBet(1));
    _betSubOneButton.addEventListener("click", () => this.setTempBet(-1));
    _betAddFiveButton.addEventListener("click", () => this.setTempBet(5));
    _betSubFiveButton.addEventListener("click", () => this.setTempBet(-5));
    const _placeBetButton = this.parent.querySelector("._placeBetButton");
    this._callButton = this.parent.querySelector("._callButton");
    _placeBetButton.addEventListener("click", () => this.send("bet", this.tempBet));
    this._callButton.addEventListener("click", () => this.call());
    this._callButtonText = this.parent.querySelector("._callButtonText");
  }
  hideShowButtons(canCheck, canBet, hideAll) {
    if(hideAll) {
      this.hide(this.foldButton.parentElement);
      this.hide(this.checkButton.parentElement);
      this.hide(this.betButton.parentElement);
    }else{
      if(canCheck) {
        this.hide(this.foldButton.parentElement);
        this.show(this.checkButton.parentElement);
        this.show(this.betButton.parentElement);
      }else if(canBet){
        this.show(this.foldButton.parentElement);
        this.hide(this.checkButton.parentElement);
        this.show(this.betButton.parentElement); 
      }else{
        this.show(this.foldButton.parentElement);
        this.hide(this.checkButton.parentElement);
        this.hide(this.betButton.parentElement);
      }
    }
  }
  hideTableCards(playerSection, visible) {
    playerSection.querySelector("._cardTableRoot").setAttribute("visible", visible || false);
  }
  updatePlayerSlices(players, game) {
    for(let i = 0;i < 8; i ++) {
      const playerId = players.filter(d => game.players[d].position === i);
      const playerSection = this.parent.querySelector("._playerPosition" + i);
      
      if(!playerId.length) {
        this.hide(playerSection);
        this.setText(playerSection.querySelector('._nameTag'), "");
        continue;
      }
      const id = playerId[0];
      const player = game.players[id];
      if(playerId[0] === window.user.id) {
        this.currentPlayerSection = playerSection;
      }
      const reset = playerSection.querySelector("._resetCardSelection");
      const submit = playerSection.querySelector("._submitCardSelection");
      this.show(playerSection);
      
      const _coinsAmount = playerSection.querySelector("._coinsAmount");
      
      this.setText(playerSection.querySelector("._coinsAmount"), player.chips);
      this.setText(playerSection.querySelector("._betAmount"), "Bet:" + (player.bet));
      this.setText(playerSection.querySelector('._nameTag'), player.name);
      this.setText(playerSection.querySelector('._nameTagTimer'), player.connected ? "" : "Disconnected: Kicking shortly!");
      
      if(game.isStarted && !game.winner) {
        this.show(playerSection.querySelector("._cardRoot"));
      }else{
        this.hide(playerSection.querySelector("._cardRoot"));
      }
      
      this.setText(playerSection.querySelector("._lastHand"), "-");
      
      if(game.isStarted && !game.winner){
        
        this.hideTableCards(playerSection, false);
        if(id === window.user.id) {
          player.cards.forEach((d, _i) => {
            const cardEle = playerSection.querySelector("._cardRoot ._card" + _i);
            if(id === window.user.id) {
              cardEle.card = d;
              cardEle.setAttribute("src", d.image);
              cardEle.setAttribute("side", "front");
            }else{
              cardEle.setAttribute("side", "double");
            }
          });
          this.hideShowButtons( player.canCheck, this.callAmount <= player.chips, id !== game.czar);
        }
        
      }else if(game.winner){
        
        this.hideTableCards(playerSection, true);
        this.hideShowButtons(false, false, true);
        this.setText(playerSection.querySelector("._lastHand"), player.lastHand.descr + (player._id === game.winner._id ? ", winner!" : ""));
        if(!player.hasFolded && players.filter(p => !game.players[p].hasFolded).length !== 1) {
          player.cards.forEach((d, _i) => {
            const cardEle = playerSection.querySelector("._cardTableRoot ._card" + _i);
            cardEle.setAttribute("src", d.image);
            cardEle.setAttribute("side", "front");
          });
        }
        
      }else{
        this.hideTableCards(playerSection, false);
      }
      
      const _playerSliceActive = playerSection.querySelector('._playerSliceActive');
      const _playerSlice = playerSection.querySelector('._playerSlice');
      
      if(id === game.czar) {
        this.betUi.setAttribute("rotation", `0 ${45 * i} 0`);
        this.show(_playerSliceActive);
        this.hide(_playerSlice);
      }else{
        this.hide(_playerSliceActive);
        this.show(_playerSlice);
      }
      
      const bigScale = 0.04;
      const smallScale = 0.015;
      
      if(id === window.user.id) {
        _playerSliceActive.setAttribute('scale', `${bigScale} ${bigScale} ${bigScale}`);
        _playerSlice.setAttribute('scale', `${bigScale} ${bigScale} ${bigScale}`);
      }else{
        _playerSliceActive.setAttribute('scale', `${smallScale} ${smallScale} ${smallScale}`);
        _playerSlice.setAttribute('scale', `${smallScale} ${smallScale} ${smallScale}`);
      }
    }
  }
  debounce(click) {
    return () => {
      clearTimeout(this.debounceClick);
      this.debounceClick = setTimeout(() => click(), 200);
    }
  }
  resetGame() {
    console.log("reset game");
    for(let i = 0; i < 5; i++) {
      const card = this.parent.querySelector('._cardCzar' + i);
      if(card) {
        card.card = null;
        card.setAttribute("src", "https://cdn.glitch.global/68a8fda1-eaf5-4ffe-8fbf-50f0798374a4/hero-texture.png?v=1697208148076");
      }
    }
    for(let i = 0;i < 8; i ++) { 
      const playerSection = this.parent.querySelector("._playerPosition" + i);
      for(let _i = 0;_i < 2; _i ++) {
        const cardEle = playerSection.querySelector('._card' + _i);
        cardEle.card = null;
        if(cardEle.clickCallback) {
          cardEle.removeEventListener("click", cardEle.clickCallback);
          cardEle.clickCallback = null;
        }
        cardEle.setAttribute("src", "https://cdn.glitch.global/68a8fda1-eaf5-4ffe-8fbf-50f0798374a4/hero-texture.png?v=1697208148076");
      };
    }
    this.hadWinner = false;
    this.tempBet = 0;
  }
  updateCenterCards(game) {
    if(game.isStarted) {
      for(let i = 0; i < 5; i++) {
        const card = this.parent.querySelector('._cardCzar' + i);
        if(card && game.tableCards[i]) {
          card.card = game.tableCards[i];
          card.setAttribute("src", game.tableCards[i].image);
        }
      }
    }
  }
  centerTableState(game) {
    let value = "Click To Join";
    if(this.userIsPlaying) {
      if(game.playerCount > 1) {
        if(game.isStarted && !game.winner) {
          this.hide(this.mainCTAJoinButton);
          this.canStart = false;
          this.show(this.gameCard);
          value = "";
          this.hide(this.startCard);
        }else{
          value = "Click To Deal";
          this.canStart = true;
          this.show(this.mainCTAJoinButton);
          this.show(this.gameCard);
          this.hideShowButtons(false, false, true);
          if(game.winner) {
            this.setText(this.currentGameState, game.winner.name + " wins! " + game.winner.lastHand.descr);
          }
        }
      }else{
        value = (2 - game.playerCount) + " More!";
        this.hide(this.mainCTAJoinButton);
      }
    }else if(this.userIsWaiting) {
      this.hide(this.mainCTAJoinButton);
      this.hide(this.startCard);
      value = "Waiting for next round...";
    }else{
      this.show(this.mainCTAJoinButton);
      value = "Click To Join";
    }
    if(game.playerCount > 9) {
      this.hide(this.mainCTAJoinButton);
      value = "Game Full";
    }
    this.setText(this.mainCTAJoinText, value);
  }
  hide(ele) {
    if(this.mainCTAJoinButton === ele || this.foldButton.parentElement === ele || this.checkButton.parentElement === ele) {
      ele.setAttribute('scale', '0 0 0');
    }
    ele.setAttribute('visible', false);
  }
  show(ele) {
    if(this.mainCTAJoinButton === ele || this.foldButton.parentElement === ele || this.checkButton.parentElement === ele) {
      ele.setAttribute('scale', this.mainCTAJoinButton === ele ? '0.7 0.7 0.7' : '0.6 0.6 0.6');
    }
    ele.setAttribute('visible', true);
  }
  syncGame(game) {
    this.canStart = false;
    this.hasSubmit = false;

    if(this.params.debug === "true") {
      console.log("sync", game);
    }

    if(!game.winner && this.hadWinner) {
      this.resetGame();
    }

    this.hadWinner = !!game.winner;

    this.currentGame = game;
    const players = Object.keys(game.players);
    this.userIsPlaying = players.indexOf(window.user.id) > -1;
    this.userIsWaiting = game.waitingRoom.map(d => d.id).indexOf(window.user.id) > -1;
    this.currentPlayer = game.players[window.user.id];
    this.callAmount = this.getCallAmount();

    this.show(this.startCard);
    this.hide(this.gameCard);

    this.centerTableState(game);
    this.updateCenterCards(game);
    this.updatePlayerSlices(players, game);
    this.betUi.setAttribute("visible", false);

    if(game.isStarted && game.czar) {
      this.setInfoState(game);
    }

    if(game.isReset) {
      this.resetGame();
    }
    
  }
  setInfoState(game) {
    const czar = game.players[game.czar];
    const playerIsCzar = game.czar === window.user.id;
    if(this.currentPlayer) {
      const currentCzarCallAmount = this.callAmount + this.currentPlayer.bet - czar.bet;
      this.setText(this.currentGameState, (playerIsCzar ? "Your turn. " : czar.name + "'s turn. ") + (currentCzarCallAmount === 0 ? "Free" : "Call " + currentCzarCallAmount) + " to stay in.");
    }
  }
  setText(ele, value) {
    if(window.isBanter) {
      setTimeout(()=>{
        window.setText(ele.object3D.id, value);
      }, this.initialWait ? 500 : 500);
    }else{
      ele.setAttribute("value", value);
    }
  }
  parseMessage(msg) {
    const json = JSON.parse(msg);
    switch(json.path) {
      case 'sync-game':
        this.syncGame(json.data);
        break;
      case 'error':
        alert(json.data);
        break;
      case 'play-sound':
        this.playSound(json.data);
        break;
    }
  }
  playSound(name){
     var audio = new Audio('https://cdn.glitch.global/68a8fda1-eaf5-4ffe-8fbf-50f0798374a4/' + name);
     audio.volume = 0.3;
     audio.play(); 
  }
  send(path, data){
    this.ws.send(JSON.stringify({path, data}));
    if(path === "bet") {
      this.tempBet = 0;
    }
  }   
  generateGuestUser() {
    let user = JSON.parse(localStorage.getItem('user'));
    if (!user) {
      const id = this.params.uid || this.getUniquId();
      user = { id, name: "Guest " + id };
      localStorage.setItem('user', JSON.stringify(user));
    }
    window.user = user;
  } 
  getUniquId() {
    return (Math.random() + 1).toString(36).substring(7);
  }
  getTableHTML() {
    
    const cardsTableHtml = `
      <a-entity class="_cardTableRoot" position="0 0.98 -0.9" rotation="-90 180 0" visible="false">
        <a-plane data-raycastable sq-collider sq-interactable class="_card0" position="0.055 0 0" scale="0.1 0.15 0.1" color="#afafaf" src="https://cdn.glitch.global/68a8fda1-eaf5-4ffe-8fbf-50f0798374a4/hero-texture.png?v=1697208148076" side="double" rotation="0 0 -3">
          <a-text baseline="top" value="-" color="#000" scale="0.4 0.3 0.4" position="-0.4 0.4 0.01"></a-text>
        </a-plane>
        <a-plane data-raycastable sq-collider sq-interactable class="_card1" position="-0.055 0 0" scale="0.1 0.15 0.1" color="#afafaf" src="https://cdn.glitch.global/68a8fda1-eaf5-4ffe-8fbf-50f0798374a4/hero-texture.png?v=1697208148076" side="double" rotation="0 0 3">
          <a-text baseline="top" value="-" color="#000" scale="0.4 0.3 0.4" position="-0.4 0.4 0.01"></a-text>
        </a-plane>
      </a-entity>
    `;
    const cardsHtml = `
      <a-entity class="_cardRoot" position="0 1.4 -1.3" rotation="-30 180 0" visible="false">
        <a-plane data-raycastable sq-collider sq-interactable class="_card0" position="0.055 0 0" scale="0.1 0.15 0.1" color="#afafaf" src="https://cdn.glitch.global/68a8fda1-eaf5-4ffe-8fbf-50f0798374a4/hero-texture.png?v=1697208148076" side="double" rotation="0 0 -3">
          <a-text baseline="top" value="-" color="#000" scale="0.4 0.3 0.4" position="-0.4 0.4 0.01"></a-text>
        </a-plane>
        <a-plane data-raycastable sq-collider sq-interactable class="_card1" position="-0.055 0 0" scale="0.1 0.15 0.1" color="#afafaf" src="https://cdn.glitch.global/68a8fda1-eaf5-4ffe-8fbf-50f0798374a4/hero-texture.png?v=1697208148076" side="double" rotation="0 0 3">
          <a-text baseline="top" value="-" color="#000" scale="0.4 0.3 0.4" position="-0.4 0.4 0.01"></a-text>
        </a-plane>
      </a-entity>
    `;
    const playerSection = Array.from({length: 8}, (v, i) => i).map(i => `<a-entity class="_playerPosition${i}" rotation="0 ${45*i} 0">
          ${cardsTableHtml + cardsHtml}
          <a-text class="_betAmount" position="0 0.96 -1.23" align="center" rotation="-90 180 0" value="0" scale="0.2 0.2 0.2"></a-text>
          <a-sphere class="_playerSliceActive" position="0 0.96 -1.14" color="green" scale="0.02 0.02 0.02"></a-sphere>
          <a-sphere class="_playerSlice" position="0 0.96 -1.14" color="white" scale="0.02 0.02 0.02"></a-sphere>
          <a-text class="_lastHand" position="0 0.98 -1" align="center" rotation="-90 180 0" value="Nametag" scale="0.1 0.1 0.1"></a-text>
          <a-text class="_nameTagTimer" position="0 0.96 -1.23" align="center" rotation="-90 0 0" value="Nametag" scale="0.08 0.08 0.08"></a-text>
          <a-text class="_nameTag" position="0 0.96 -1.55" align="center" rotation="-90 180 0" value="Nametag" scale="0.1 0.1 0.1"></a-text>
          <a-text class="_coinsAmount" position="0 0.85 -1.44" align="center" rotation="-90 180 0" value="0" scale="0.2 0.2 0.2"></a-text>
          <a-entity class="chips" position="0 0.87 -1.38">
            <a-cylinder scale="0.03 0.003 0.03" class="blinds" color="gold"></a-cylinder>
            <a-cylinder scale="0.03 0.003 0.03" position="-0.0012 0.003 0.0018" class="flop" color="gold"></a-cylinder>
            <a-cylinder scale="0.03 0.003 0.03" position="0.0014 0.006 -0.0012" class="flop" color="gold"></a-cylinder>
            <a-cylinder scale="0.03 0.003 0.03" position="0.0021 0.009 0.0016" class="river" color="gold"></a-cylinder>
            <a-cylinder scale="0.03 0.003 0.03" position="0.002 0.012 0.001" class="river" color="gold"></a-cylinder>
            <a-cylinder scale="0.03 0.003 0.03" position="-0.0017 0.015 0.0014" class="river" color="gold"></a-cylinder>
            <a-cylinder scale="0.03 0.003 0.03" position="0.0019 0.018 -0.0022" class="turn" color="gold"></a-cylinder>
            <a-cylinder scale="0.03 0.003 0.03" position="0.0013 0.021 0.0011" class="turn" color="gold"></a-cylinder>
            <a-cylinder scale="0.03 0.003 0.03" position="0.0019 0.024 0.0014" class="turn" color="gold"></a-cylinder>
            <a-cylinder scale="0.03 0.003 0.03" position="0.0011 0.027 0.0018" class="turn" color="gold"></a-cylinder>
          </a-entity>
        </a-entity>`).join("");
    const html = `
        <a-box scale="0.1 0.1 0.1" color="red" class="resetGame" data-raycastable sq-collider sq-interactable position="0 1 0"></a-box>
        <a-entity gltf-model="https://cdn.glitch.global/ea12104f-2e64-4745-b3c8-9e0a489b98fb/pokertable_round.glb?v=1697543772802" scale="0.025 0.015 0.025" position="0 1 0"></a-entity>
          ${playerSection}
          <a-entity class="betUi" visible="false">
            <a-entity position="0 0.98 -1.4">
              <a-entity position="-0.22 0 0.16" rotation="-90 0 180">
                <a-entity class="_betAddOneButton" data-raycastable sq-boxcollider="size: 0.3 0.2 0.05" sq-interactable gltf-model="https://cdn.glitch.global/cf03534b-1293-4351-8903-ba15ffa931d3/ButtonS.glb?v=1689782700343" scale="0.4 0.4 0.4" rotation="0 180 0"></a-entity>
                <a-text value="+1" sq-billboard scale="0.3 0.3 0.3" align="center" rotation="0 0 0" position="0 0 0"></a-text>
              </a-entity>
              <a-entity position="0.22 0 0.16" rotation="-90 0 180">
                <a-entity class="_betAddFiveButton" data-raycastable sq-boxcollider="size: 0.3 0.2 0.05" sq-interactable gltf-model="https://cdn.glitch.global/cf03534b-1293-4351-8903-ba15ffa931d3/ButtonS.glb?v=1689782700343" scale="0.4 0.4 0.4" rotation="0 180 0"></a-entity>
                <a-text value="+5" sq-billboard scale="0.3 0.3 0.3" align="center" rotation="0 0 0" position="0 0 0"></a-text>
              </a-entity>
              <a-entity position="-0.22 0 0.02" rotation="-90 0 180">
                <a-entity class="_betSubOneButton" data-raycastable sq-boxcollider="size: 0.3 0.2 0.05" sq-interactable gltf-model="https://cdn.glitch.global/cf03534b-1293-4351-8903-ba15ffa931d3/ButtonS.glb?v=1689782700343" scale="0.4 0.4 0.4" rotation="0 180 0"></a-entity>
                <a-text value="-1" sq-billboard scale="0.3 0.3 0.3" align="center" rotation="0 0 0" position="0 0 0"></a-text>
              </a-entity>
              <a-entity position="0.22 0 0.02" rotation="-90 0 180">
                <a-entity class="_betSubFiveButton" data-raycastable sq-boxcollider="size: 0.3 0.2 0.05" sq-interactable gltf-model="https://cdn.glitch.global/cf03534b-1293-4351-8903-ba15ffa931d3/ButtonS.glb?v=1689782700343" scale="0.4 0.4 0.4" rotation="0 180 0"></a-entity>
                <a-text value="-5" sq-billboard scale="0.3 0.3 0.3" align="center" rotation="0 0 0" position="0 0 0"></a-text>
              </a-entity>
              <a-entity position="0.22 0 -0.12" rotation="-90 0 180">
                <a-entity class="_callButton" data-raycastable sq-boxcollider="size: 0.3 0.2 0.05" sq-interactable gltf-model="https://cdn.glitch.global/cf03534b-1293-4351-8903-ba15ffa931d3/ButtonS.glb?v=1689782700343" scale="0.4 0.4 0.4" rotation="0 180 0"></a-entity>
                <a-text value="Call" class="_callButtonText" sq-billboard scale="0.15 0.15 0.15" align="center" rotation="0 0 0" position="0 0 0"></a-text>
              </a-entity>
              <a-entity position="-0.22 0 -0.12" rotation="-90 0 180">
                <a-entity class="_placeBetButton" data-raycastable sq-boxcollider="size: 0.3 0.2 0.05" sq-interactable gltf-model="https://cdn.glitch.global/cf03534b-1293-4351-8903-ba15ffa931d3/ButtonS.glb?v=1689782700343" scale="0.4 0.4 0.4" rotation="0 180 0"></a-entity>
                <a-text value="Bet" sq-billboard scale="0.15 0.15 0.15" align="center" rotation="0 0 0" position="0 0 0"></a-text>
              </a-entity>
            </a-entity>
          </a-entity>
          <a-entity position="0 2 0" class="_gameCard">
            <a-entity sq-billboard look-at="[camera]">
              <a-text class="_currentGameState" position="0 -0.35 0" align="center" rotation="0 0 0" value="" scale="0.2 0.2 0.2"></a-text>
              <a-plane class="_cardCzar0" position="-0.8 0 0" scale="0.375 0.55125 0.375" color="#afafaf" rotation="0 0 0" 
               src="https://cdn.glitch.global/68a8fda1-eaf5-4ffe-8fbf-50f0798374a4/hero-texture.png?v=1697208148076" side="double" visible="true"></a-plane>
              <a-plane class="_cardCzar1"position="-0.4 0 0" scale="0.375 0.55125 0.375" color="#afafaf" rotation="0 0 0" 
               src="https://cdn.glitch.global/68a8fda1-eaf5-4ffe-8fbf-50f0798374a4/hero-texture.png?v=1697208148076" side="double" visible="true"></a-plane>
              <a-plane class="_cardCzar2" position="0 0 0" scale="0.375 0.55125 0.375" color="#afafaf" rotation="0 0 0" 
               src="https://cdn.glitch.global/68a8fda1-eaf5-4ffe-8fbf-50f0798374a4/hero-texture.png?v=1697208148076" side="double" visible="true"></a-plane>
              <a-plane class="_cardCzar3" position="0.4 0 0" scale="0.375 0.55125 0.375" color="#afafaf" rotation="0 0 0" 
               src="https://cdn.glitch.global/68a8fda1-eaf5-4ffe-8fbf-50f0798374a4/hero-texture.png?v=1697208148076" side="double" visible="true"></a-plane>
              <a-plane class="_cardCzar4" position="0.8 0 0" scale="0.375 0.55125 0.375" color="#afafaf" rotation="0 0 0" 
               src="https://cdn.glitch.global/68a8fda1-eaf5-4ffe-8fbf-50f0798374a4/hero-texture.png?v=1697208148076" side="double" visible="true"></a-plane>
            </a-entity>
            <a-entity sq-billboard look-at="[camera]" position="0 -0.5 0">
              <a-entity position="0.1 0 0" scale="0.6 0.6 0.6">
                <a-entity class="_foldOption" data-raycastable sq-boxcollider="size: 0.3 0.2 0.05" sq-interactable rotation="0 180 0" gltf-model="https://cdn.glitch.global/cf03534b-1293-4351-8903-ba15ffa931d3/ButtonS.glb?v=1689782700343"></a-entity>
                <a-text value="Fold" align="center" rotation="0 0 0" scale="0.4 0.4 0.4"></a-text>
              </a-entity>
              <a-entity position="0.1 0 0" scale="0.6 0.6 0.6">
                <a-entity class="_checkOption" data-raycastable sq-boxcollider="size: 0.3 0.2 0.05" sq-interactable rotation="0 180 0" gltf-model="https://cdn.glitch.global/cf03534b-1293-4351-8903-ba15ffa931d3/ButtonS.glb?v=1689782700343"></a-entity>
                <a-text value="Check" align="center" rotation="0 0 0" scale="0.4 0.4 0.4"></a-text>
              </a-entity>
              <a-entity position="-0.1 0 0" scale="0.6 0.6 0.6">
                <a-entity class="_betOption" data-raycastable sq-boxcollider="size: 0.3 0.2 0.05" sq-interactable rotation="0 180 0" gltf-model="https://cdn.glitch.global/cf03534b-1293-4351-8903-ba15ffa931d3/ButtonS.glb?v=1689782700343"></a-entity>
                <a-text value="Bet" align="center" rotation="0 0 0" scale="0.4 0.4 0.4"></a-text>
              </a-entity>
            </a-entity>

          </a-entity>

          <a-text value="" sq-billboard class="_clickToJoin" align="center" scale="0.3 0.3 0.3" rotation="0 180 0" position="0 1.3 -0.025"></a-text>

          <a-entity position="0 2 0" class="_startCard">
            <a-entity sq-billboard position="0 -0.7 0" >
              <a-entity class="_clickToJoinButton" visible="false" data-raycastable sq-boxcollider="size: 0.6 0.2 0.05" sq-interactable gltf-model="https://cdn.glitch.global/cf03534b-1293-4351-8903-ba15ffa931d3/ButtonL.glb?v=1689782699922" scale="0.7 0.7 0.7" rotation="0 180 0"></a-entity>
            </a-entity>
          </a-entity>

          <a-entity position="0 0.1 0">
            <a-ring rotation="-90 0 0" radius-inner="0.12" radius-outer="0.17" position="0 1 0" color="#118e98" animation="property: position; from: 0 1 0; to: 0 0.86 0; loop: true; dir: alternate; easing: linear; dur: 3000"></a-ring>
            <a-ring rotation="-90 0 0" radius-inner="0.18" radius-outer="0.23" position="0 1 0" color="#118e98" animation="property: position; from: 0 0.98 0; to: 0 0.88 0; loop: true; dir: alternate; easing: linear; dur: 3000;"></a-ring>
            <a-ring rotation="-90 0 0" radius-inner="0.24" radius-outer="0.29" position="0 1 0" color="#118e98" animation="property: position; from: 0 0.96 0; to: 0 0.90 0; loop: true; dir: alternate; easing: linear; dur: 3000;"></a-ring>
          </a-entity>
      `;
    
      const parent = document.createElement("a-entity");
      parent.setAttribute("position", this.params.position);
      parent.setAttribute("rotation", this.params.rotation);
      parent.setAttribute("scale", "0 0 0");
      parent.insertAdjacentHTML('beforeEnd', html);
      document.querySelector('a-scene').appendChild(parent);
      
    return parent;
  }
}
if(window.isBanter) {
  window.loadDoneCallback = () => window.banterLoaded = true;
}
window.gameSystem = new PokerGameSystem();