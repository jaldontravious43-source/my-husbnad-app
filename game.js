(() => {
  "use strict";

  // ===== 基础配置 =====
  const SUPABASE_URL = "https://bkhccodrqyiesweghhsc.supabase.co";
  const BUCKET = "game-images";

  const RULES = {
    roundSeconds: 60,
    lives: 3,
    targetScore: 1200
  };
  const IMAGE_FETCH_TIMEOUT_MS = 2600;

  // Phaser 在某些环境对 data: 图片会出现加载兼容问题，这里改为同源静态占位图。
  const PLACEHOLDER_DATA_URL = "./icons/icon-192.png";

  const TYPE_CONFIG = {
    stars: {
      label: "明星帅哥",
      sizePx: 170,
      minSpeed: 70,
      maxSpeed: 115,
      scoreMin: 150,
      scoreMax: 300,
      pullSpeed: 240,
      radiusMul: 0.42
    },
    hamster: {
      label: "我的仓鼠",
      sizePx: 92,
      minSpeed: 190,
      maxSpeed: 280,
      scoreMin: 80,
      scoreMax: 120,
      pullSpeed: 340,
      radiusMul: 0.38
    },
    ugly: {
      label: "丑男",
      sizePx: 210,
      minSpeed: 35,
      maxSpeed: 65,
      scoreMin: -200,
      scoreMax: -50,
      pullSpeed: 110,
      radiusMul: 0.45
    },
    mystery: {
      label: "隐藏问号箱",
      sizePx: 130,
      minSpeed: 230,
      maxSpeed: 350,
      scoreMin: 0,
      scoreMax: 0,
      pullSpeed: 260,
      radiusMul: 0.4
    },
    husband: {
      label: "我老公",
      sizePx: 108,
      minSpeed: 330,
      maxSpeed: 460,
      scoreMin: 500,
      scoreMax: 1000,
      pullSpeed: 430,
      radiusMul: 0.38
    }
  };

  const $ = (id) => document.getElementById(id);
  const scoreEl = $("score");
  const targetEl = $("target");
  const livesEl = $("lives");
  const timeEl = $("time");
  const msgEl = $("msg");
  const overlayEl = $("overlay");
  const resultTitleEl = $("result-title");
  const resultTextEl = $("result-text");
  const restartBtn = $("restart-btn");
  let gameInstance = null;
  let lastBootData = null;

  targetEl.textContent = String(RULES.targetScore);

  function setMessage(text) {
    msgEl.textContent = text;
  }

  function getGameId() {
    const gid = new URLSearchParams(window.location.search).get("gid");
    return gid ? gid.trim() : "";
  }

  function getPublicUrl(path) {
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  }

  function getPlaceholderMap() {
    return {
      stars: PLACEHOLDER_DATA_URL,
      hamster: PLACEHOLDER_DATA_URL,
      ugly: PLACEHOLDER_DATA_URL,
      husband: PLACEHOLDER_DATA_URL
    };
  }

  // 改为 fetch + AbortController 超时下载，避免 Phaser 直接加载远程图时长时间卡住。
  async function fetchImageSource(url, objectUrls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(`${url}?t=${Date.now()}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) return PLACEHOLDER_DATA_URL;
      const blob = await response.blob();
      if (!blob || !String(blob.type || "").startsWith("image/")) return PLACEHOLDER_DATA_URL;

      const objectUrl = URL.createObjectURL(blob);
      objectUrls.push(objectUrl);
      return objectUrl;
    } catch {
      clearTimeout(timeoutId);
      return PLACEHOLDER_DATA_URL;
    }
  }

  async function buildImageSources(gid, objectUrls) {
    const map = getPlaceholderMap();

    const keys = ["stars", "hamster", "ugly", "husband"];
    await Promise.all(keys.map(async (key) => {
      const url = getPublicUrl(`${gid}/${key}.png`);
      map[key] = await fetchImageSource(url, objectUrls);
    }));

    return map;
  }

  class GoldHookScene extends Phaser.Scene {
    constructor() {
      super("GoldHookScene");
      this.images = {};
      this.targets = [];
      this.score = 0;
      this.lives = RULES.lives;
      this.timeLeft = RULES.roundSeconds;
      this.ended = false;

      this.anchorX = 0;
      this.anchorY = 0;
      this.ropeLen = 70;
      this.minRopeLen = 70;
      this.maxRopeLen = 540;
      this.hookAngle = -65;
      this.swingSpeed = 75;
      this.swingDir = 1;
      this.hookRadius = 10;
      this.hookState = "swing";
      this.extendSpeed = 760;
      this.retractSpeed = 420;
      this.currentRetractSpeed = 420;
      this.caughtTarget = null;
      this.shotMissed = false;
    }

    launchHook() {
      if (this.ended) return;
      if (this.hookState !== "swing") return;
      this.hookState = "extending";
      this.shotMissed = false;
    }

    init(data) {
      this.images = data.images;
      this.gid = data.gid;
      this.targets = [];
      this.score = 0;
      this.lives = RULES.lives;
      this.timeLeft = RULES.roundSeconds;
      this.ended = false;

      this.ropeLen = 70;
      this.minRopeLen = 70;
      this.maxRopeLen = 540;
      this.hookAngle = -65;
      this.swingSpeed = 75;
      this.swingDir = 1;
      this.hookRadius = 10;
      this.hookState = "swing";
      this.extendSpeed = 760;
      this.retractSpeed = 420;
      this.currentRetractSpeed = 420;
      this.caughtTarget = null;
      this.shotMissed = false;
    }

    preload() {
      // 先加载 4 个本地兜底纹理，确保任何云图失败都不会出现黑绿缺图方块。
      this.load.image("fallback_stars", PLACEHOLDER_DATA_URL);
      this.load.image("fallback_hamster", PLACEHOLDER_DATA_URL);
      this.load.image("fallback_ugly", PLACEHOLDER_DATA_URL);
      this.load.image("fallback_husband", PLACEHOLDER_DATA_URL);

      this.load.image("stars", this.images.stars);
      this.load.image("hamster", this.images.hamster);
      this.load.image("ugly", this.images.ugly);
      this.load.image("husband", this.images.husband);
    }

    create() {
      this.cameras.main.setBackgroundColor("#fcecff");

      const w = this.scale.width;
      const h = this.scale.height;
      this.anchorX = w * 0.5;
      this.anchorY = 108;
      this.maxRopeLen = Math.max(320, h - 170);

      // 低内存优化：只在下半区启用目标物理运动，减少无用碰撞计算。
      this.physics.world.setBounds(0, 150, w, h - 150);

      this.createBackdrop(w, h);
      this.createMysteryBoxTexture();

      this.ropeGraphics = this.add.graphics();
      this.hookHead = this.add.circle(this.anchorX, this.anchorY + this.ropeLen, this.hookRadius, 0xffffff);
      this.hookHead.setStrokeStyle(2, 0x9a2f86, 1);
      this.anchorDot = this.add.circle(this.anchorX, this.anchorY, 12, 0xffa9d1).setStrokeStyle(2, 0x9a2f86, 1);

      this.spawnInitialTargets();
      this.bindInput();
      this.startTimers();
      this.refreshHud();
      setMessage("点击任意位置发射钩子");
    }

    createBackdrop(w, h) {
      const g = this.add.graphics();
      g.fillStyle(0xfff4fb, 1);
      g.fillRect(0, 0, w, 150);

      g.fillStyle(0xf2d2f7, 1);
      g.fillRect(0, 150, w, h - 150);

      g.lineStyle(2, 0xe5b3e9, 1);
      for (let y = 185; y < h; y += 55) {
        g.lineBetween(0, y, w, y);
      }
    }

    createMysteryBoxTexture() {
      const size = 90;
      const g = this.add.graphics();
      g.fillStyle(0xffdf6f, 1);
      g.fillRoundedRect(0, 0, size, size, 14);
      g.lineStyle(4, 0x9d5f00, 1);
      g.strokeRoundedRect(0, 0, size, size, 14);
      g.lineStyle(5, 0x9d5f00, 1);
      g.beginPath();
      g.moveTo(size * 0.5, 14);
      g.lineTo(size * 0.5, size - 14);
      g.strokePath();
      g.fillStyle(0x9d5f00, 1);
      g.fillCircle(size * 0.5, size * 0.72, 4);
      g.generateTexture("mystery_box", size, size);
      g.destroy();
    }

    bindInput() {
      this.input.on("pointerdown", () => this.launchHook());
      this.input.on("gameobjectdown", () => this.launchHook());
      this.input.keyboard?.on("keydown-SPACE", () => this.launchHook());
    }

    startTimers() {
      this.clockEvent = this.time.addEvent({
        delay: 1000,
        loop: true,
        callback: () => {
          if (this.ended) return;

          this.timeLeft -= 1;
          if (this.timeLeft <= 0) {
            this.timeLeft = 0;
            this.refreshHud();
            this.finishGame(this.score >= RULES.targetScore);
            return;
          }
          this.refreshHud();
        }
      });

      // 高速目标定时改变方向，制造不规则轨迹。
      this.turnEvent = this.time.addEvent({
        delay: 580,
        loop: true,
        callback: () => {
          for (const t of this.targets) {
            if (!t.active || t === this.caughtTarget) continue;
            const type = t.getData("type");
            if (type !== "mystery" && type !== "husband") continue;

            const cfg = TYPE_CONFIG[type];
            this.setRandomVelocity(t, cfg.minSpeed, cfg.maxSpeed);
          }
        }
      });
    }

    spawnInitialTargets() {
      // 控制总对象数量，降低低内存设备的 GC 压力。
      this.spawnTarget("stars", 3);
      this.spawnTarget("hamster", 5);
      this.spawnTarget("ugly", 2);
      this.spawnTarget("mystery", 1);
    }

    spawnTarget(type, count = 1) {
      const cfg = TYPE_CONFIG[type];
      const texture = this.resolveTextureKey(type);

      for (let i = 0; i < count; i++) {
        const pos = this.findSpawnPoint(Math.max(42, cfg.sizePx * 0.5));
        const sprite = this.physics.add.image(pos.x, pos.y, texture);

        this.fitSpriteToSize(sprite, cfg.sizePx);
        sprite.setCollideWorldBounds(true);
        sprite.setBounce(1, 1);

        const score = Phaser.Math.Between(cfg.scoreMin, cfg.scoreMax);
        sprite.setData("type", type);
        sprite.setData("label", cfg.label);
        sprite.setData("score", score);
        sprite.setData("pullSpeed", cfg.pullSpeed);

        const bodyRadius = Math.max(12, Math.floor(Math.min(sprite.displayWidth, sprite.displayHeight) * cfg.radiusMul));
        sprite.body.setCircle(bodyRadius);

        this.setRandomVelocity(sprite, cfg.minSpeed, cfg.maxSpeed);

        this.targets.push(sprite);
      }
    }

    resolveTextureKey(type) {
      if (type === "mystery") return "mystery_box";
      if (this.isTextureUsable(type)) return type;
      return `fallback_${type}`;
    }

    isTextureUsable(key) {
      if (!this.textures.exists(key)) return false;
      const tex = this.textures.get(key);
      if (!tex || tex.key === "__MISSING") return false;
      const src = tex.getSourceImage ? tex.getSourceImage() : null;
      if (!src) return false;
      const w = Number(src.width || 0);
      const h = Number(src.height || 0);
      return w > 2 && h > 2;
    }

    // 统一按目标最大边缩放，避免用户上传超大图片后撑爆画面。
    fitSpriteToSize(sprite, targetMaxSizePx) {
      const tw = Math.max(1, sprite.width);
      const th = Math.max(1, sprite.height);
      const ratio = targetMaxSizePx / Math.max(tw, th);
      const safeRatio = Phaser.Math.Clamp(ratio, 0.04, 1.1);
      sprite.setScale(safeRatio);
      sprite.setDepth(2);
    }

    findSpawnPoint(pad) {
      const minX = 40;
      const maxX = this.scale.width - 40;
      const minY = 210;
      const maxY = this.scale.height - 40;

      for (let i = 0; i < 30; i++) {
        const x = Phaser.Math.Between(minX, maxX);
        const y = Phaser.Math.Between(minY, maxY);
        let overlap = false;

        for (const t of this.targets) {
          if (!t.active) continue;
          const otherPad = Math.max(24, Math.max(t.displayWidth, t.displayHeight) * 0.42);
          if (Phaser.Math.Distance.Between(x, y, t.x, t.y) < (pad + otherPad)) {
            overlap = true;
            break;
          }
        }

        if (!overlap) return { x, y };
      }

      return {
        x: Phaser.Math.Between(minX, maxX),
        y: Phaser.Math.Between(minY, maxY)
      };
    }

    setRandomVelocity(sprite, min, max) {
      const speed = Phaser.Math.Between(min, max);
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      sprite.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    }

    update(_, dtMs) {
      if (this.ended) return;

      const dt = dtMs / 1000;

      if (this.hookState === "swing") {
        this.hookAngle += this.swingDir * this.swingSpeed * dt;
        if (this.hookAngle >= 72) {
          this.hookAngle = 72;
          this.swingDir = -1;
        } else if (this.hookAngle <= -72) {
          this.hookAngle = -72;
          this.swingDir = 1;
        }
      } else if (this.hookState === "extending") {
        this.ropeLen += this.extendSpeed * dt;
        if (!this.caughtTarget) this.checkCatch();

        if (this.ropeLen >= this.maxRopeLen) {
          this.ropeLen = this.maxRopeLen;
          if (!this.caughtTarget) this.shotMissed = true;
          this.startRetract(this.retractSpeed);
        }
      } else if (this.hookState === "retracting") {
        this.ropeLen -= this.currentRetractSpeed * dt;
        if (this.ropeLen <= this.minRopeLen) {
          this.ropeLen = this.minRopeLen;
          this.resolveRetract();
        }
      }

      const tip = this.getHookTip();
      this.hookHead.setPosition(tip.x, tip.y);

      if (this.caughtTarget?.active) {
        this.caughtTarget.setPosition(tip.x, tip.y + this.caughtTarget.displayHeight * 0.18);
      }

      this.drawRope(tip.x, tip.y);
    }

    checkCatch() {
      const tip = this.getHookTip();
      for (const t of this.targets) {
        if (!t.active) continue;

        const radius = Math.max(10, Math.min(t.displayWidth, t.displayHeight) * 0.35);
        if (Phaser.Math.Distance.Between(tip.x, tip.y, t.x, t.y) <= radius + this.hookRadius) {
          this.catchTarget(t);
          return;
        }
      }
    }

    catchTarget(target) {
      this.caughtTarget = target;
      target.body.setVelocity(0, 0);
      target.body.enable = false;

      const pullSpeed = Number(target.getData("pullSpeed") || this.retractSpeed);
      this.startRetract(pullSpeed);
    }

    startRetract(speed) {
      this.hookState = "retracting";
      this.currentRetractSpeed = speed;
    }

    resolveRetract() {
      if (this.caughtTarget?.active) {
        this.handleCatchResult(this.caughtTarget);
        this.caughtTarget.destroy();
      } else if (this.shotMissed) {
        setMessage("空钩不扣命，继续抓");
      }

      this.caughtTarget = null;
      this.shotMissed = false;
      this.hookState = "swing";

      this.refreshHud();
      this.trimTargets();
    }

    handleCatchResult(target) {
      const type = target.getData("type");
      const label = target.getData("label");
      const score = Number(target.getData("score") || 0);

      if (type === "mystery") {
        setMessage("隐藏款开箱！我老公出现了，快抓住他！");
        this.spawnTarget("husband", 1);
        return;
      }

      this.score += score;

      const sign = score >= 0 ? "+" : "";
      setMessage(`${label} ${sign}${score}`);
    }

    trimTargets() {
      this.targets = this.targets.filter((t) => t.active);

      // 动态补充目标，让对局在 60 秒内保持可抓取节奏。
      const living = this.targets.length;
      if (living < 7) {
        this.spawnTarget("hamster", 1);
      }
      if (!this.targets.some((t) => t.active && t.getData("type") === "stars")) {
        this.spawnTarget("stars", 1);
      }
      if (!this.targets.some((t) => t.active && t.getData("type") === "mystery") && Phaser.Math.Between(0, 100) < 24) {
        this.spawnTarget("mystery", 1);
      }
    }

    refreshHud() {
      scoreEl.textContent = String(this.score);
      livesEl.textContent = String(Math.max(0, this.lives));
      timeEl.textContent = String(Math.max(0, this.timeLeft));
    }

    drawRope(x, y) {
      this.ropeGraphics.clear();
      this.ropeGraphics.lineStyle(4, 0xffffff, 0.92);
      this.ropeGraphics.beginPath();
      this.ropeGraphics.moveTo(this.anchorX, this.anchorY);
      this.ropeGraphics.lineTo(x, y);
      this.ropeGraphics.strokePath();

      this.ropeGraphics.lineStyle(1, 0x8f3c81, 1);
      this.ropeGraphics.beginPath();
      this.ropeGraphics.moveTo(this.anchorX, this.anchorY);
      this.ropeGraphics.lineTo(x, y);
      this.ropeGraphics.strokePath();
    }

    getHookTip() {
      const rad = Phaser.Math.DegToRad(this.hookAngle);
      return {
        x: this.anchorX + Math.sin(rad) * this.ropeLen,
        y: this.anchorY + Math.cos(rad) * this.ropeLen
      };
    }

    finishGame(success) {
      if (this.ended) return;
      this.ended = true;

      this.clockEvent?.remove(false);
      this.turnEvent?.remove(false);
      this.physics.pause();

      resultTitleEl.textContent = success ? "挑战成功" : "挑战失败";
      resultTextEl.textContent = [
        `本局分数：${this.score}`,
        `目标分数：${RULES.targetScore}`,
        `剩余生命：${Math.max(0, this.lives)}`,
        `Game ID：${this.gid}`
      ].join("\n");

      overlayEl.style.display = "flex";
      setMessage(success ? "你抓到好多帅哥和老公！" : "再试一次，你马上就能赢");
    }
  }

  async function bootstrap() {
    const gid = getGameId();
    if (!gid) {
      overlayEl.style.display = "flex";
      resultTitleEl.textContent = "缺少游戏ID";
      resultTextEl.textContent = "链接参数缺少 gid，正确示例：\n/game.html?gid=你的UUID";
      setMessage("请从上传页生成链接后再进入");
      return;
    }

    if (!window.Phaser) {
      throw new Error("Phaser 引擎加载失败，请刷新后重试。");
    }

    setMessage("正在加载云端图片...");
    const objectUrls = [];
    const images = await buildImageSources(gid, objectUrls);

    if (Object.values(images).every((v) => v === PLACEHOLDER_DATA_URL)) {
      setMessage("云图较慢，已使用占位图先开局");
    }

    window.addEventListener("beforeunload", () => {
      for (const url of objectUrls) URL.revokeObjectURL(url);
    }, { once: true });

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "game-root",
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: "#fcecff",
      physics: {
        default: "arcade",
        arcade: {
          gravity: { y: 0 },
          debug: false
        }
      },
      fps: {
        target: 60,
        forceSetTimeOut: true
      },
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
      },
      scene: [GoldHookScene]
    });

    game.scene.start("GoldHookScene", { images, gid });
    gameInstance = game;
    lastBootData = { images, gid };
  }

  restartBtn.addEventListener("click", () => {
    if (gameInstance && lastBootData) {
      overlayEl.style.display = "none";
      resultTitleEl.textContent = "";
      resultTextEl.textContent = "";
      gameInstance.scene.stop("GoldHookScene");
      gameInstance.scene.start("GoldHookScene", lastBootData);
      setMessage("点击任意位置发射钩子");
      return;
    }
    window.location.reload();
  });

  bootstrap().catch((err) => {
    overlayEl.style.display = "flex";
    resultTitleEl.textContent = "加载失败";
    resultTextEl.textContent = String(err?.message || err);
    setMessage("请检查网络或 Supabase 配置");
  });
})();
