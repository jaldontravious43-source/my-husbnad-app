(() => {
  "use strict";

  // ===== 基础配置 =====
  const SUPABASE_URL = "https://bkhccodrqyiesweghhsc.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_vqG9GOJ8TLuhXAhCb2rZ5w_fRTbmSnN";
  const BUCKET = "game-images";

  const RULES = {
    roundSeconds: 60,
    lives: 3,
    targetScore: 1200
  };

  // 使用内联 SVG 作为兜底占位图，避免额外请求，节省内存和网络。
  const PLACEHOLDER_DATA_URL =
    "data:image/svg+xml;utf8," +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="100%" height="100%" fill="#fff2fb"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#ad4d8a" font-size="36" font-family="sans-serif">图片加载失败</text></svg>');

  const TYPE_CONFIG = {
    stars: {
      label: "明星帅哥",
      scale: 0.23,
      minSpeed: 70,
      maxSpeed: 115,
      scoreMin: 150,
      scoreMax: 300,
      pullSpeed: 240,
      radiusMul: 0.42
    },
    hamster: {
      label: "我的仓鼠",
      scale: 0.12,
      minSpeed: 190,
      maxSpeed: 280,
      scoreMin: 80,
      scoreMax: 120,
      pullSpeed: 340,
      radiusMul: 0.38
    },
    ugly: {
      label: "丑男",
      scale: 0.29,
      minSpeed: 35,
      maxSpeed: 65,
      scoreMin: -200,
      scoreMax: -50,
      pullSpeed: 110,
      radiusMul: 0.45
    },
    mystery: {
      label: "隐藏问号箱",
      scale: 0.2,
      minSpeed: 230,
      maxSpeed: 350,
      scoreMin: 0,
      scoreMax: 0,
      pullSpeed: 260,
      radiusMul: 0.4
    },
    husband: {
      label: "我老公",
      scale: 0.16,
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

  // 加载前预检查图片地址是否可用，不可用则回退占位图。
  function probeImage(url) {
    return new Promise((resolve) => {
      const image = new Image();
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve(false);
      }, 3500);

      image.onload = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(true);
      };
      image.onerror = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(false);
      };

      image.referrerPolicy = "no-referrer";
      image.src = `${url}?t=${Date.now()}`;
    });
  }

  async function buildImageSources(gid) {
    const map = {
      stars: PLACEHOLDER_DATA_URL,
      hamster: PLACEHOLDER_DATA_URL,
      ugly: PLACEHOLDER_DATA_URL,
      husband: PLACEHOLDER_DATA_URL
    };

    const keys = ["stars", "hamster", "ugly", "husband"];
    for (const key of keys) {
      const url = getPublicUrl(`${gid}/${key}.png`);
      const ok = await probeImage(url);
      map[key] = ok ? url : PLACEHOLDER_DATA_URL;
    }

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

    init(data) {
      this.images = data.images;
      this.gid = data.gid;
    }

    preload() {
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
      this.input.on("pointerdown", () => {
        if (this.ended) return;
        if (this.hookState !== "swing") return;

        this.hookState = "extending";
        this.shotMissed = false;
      });
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
      const texture = type === "mystery" ? "mystery_box" : type;

      for (let i = 0; i < count; i++) {
        const pos = this.findSpawnPoint(28);
        const sprite = this.physics.add.image(pos.x, pos.y, texture);

        sprite.setScale(cfg.scale);
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
          if (Phaser.Math.Distance.Between(x, y, t.x, t.y) < Math.max(pad, t.displayWidth * 0.45)) {
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
        this.lives -= 1;
        setMessage("空钩惩罚：生命 -1");
      }

      this.caughtTarget = null;
      this.shotMissed = false;
      this.hookState = "swing";

      this.refreshHud();
      this.trimTargets();

      if (this.score >= RULES.targetScore) {
        this.finishGame(true);
        return;
      }

      if (this.lives <= 0) {
        this.finishGame(false);
      }
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
      if (type === "ugly") {
        // 丑男负分之外再扣 1 生命，强化“拖后腿”的惩罚感。
        this.lives -= 1;
      }

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

    // 初始化客户端，方便后续扩展读取数据库配置。
    window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    setMessage("正在加载云端图片...");
    const images = await buildImageSources(gid);

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
  }

  restartBtn.addEventListener("click", () => {
    window.location.reload();
  });

  bootstrap().catch((err) => {
    overlayEl.style.display = "flex";
    resultTitleEl.textContent = "加载失败";
    resultTextEl.textContent = String(err?.message || err);
    setMessage("请检查网络或 Supabase 配置");
  });
})();
