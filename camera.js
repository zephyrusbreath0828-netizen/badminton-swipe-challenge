/**
 * 疑似3Dカメラ
 * ワールド座標 (x: 左右 / y: 高さ / z: 奥行き) をスクリーン座標へ射影する。
 *  - x=0 がコート中央、z=0 がプレイヤーのベースライン、z=13.4 が相手ベースライン
 *  - 透視投影 + 横方向スケール補正でスマホ縦画面に収める
 */
import { CONFIG } from '../config.js';

export class Camera {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.cx = 0;
    this.horizon = 0;
    this.focal = 0;
    this.xScale = CONFIG.camera.widthScale;
    this.camY = CONFIG.camera.y;
    this.camZ = CONFIG.camera.z;
  }

  /**
   * @param {number} width CSSピクセル幅
   * @param {number} height CSSピクセル高さ
   */
  resize(width, height) {
    this.width = width;
    this.height = height;
    this.cx = width / 2;
    this.horizon = height * CONFIG.camera.horizonRatio;
    this.focal = height * CONFIG.camera.focalRatio;
  }

  /** px per meter（その奥行きでのスケール） */
  scaleAt(z) {
    return this.focal / Math.max(z - this.camZ, 0.6);
  }

  /**
   * @returns {{x:number,y:number,s:number,depth:number}}
   */
  project(x, y, z) {
    const depth = Math.max(z - this.camZ, 0.6);
    const s = this.focal / depth;
    return {
      x: this.cx + x * this.xScale * s,
      y: this.horizon + (this.camY - y) * s,
      s,
      depth,
    };
  }

  /** ワールド上の直線をスクリーン座標配列へ */
  projectLine(points) {
    return points.map((p) => this.project(p[0], p[1] ?? 0, p[2]));
  }

  /** 画面外（上方向）へ出たか */
  isAboveScreen(p) {
    return p.y < -20;
  }
}
