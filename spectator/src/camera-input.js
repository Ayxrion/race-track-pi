// Touch and mouse gesture state shared by grandstand, chase and onboard views.
// Overview still uses Three's OrbitControls; we only suppress taps after gestures.
export class CameraInput {
  constructor(canvas,{drag,zoom,pick,customZoom=()=>true}) {
    Object.assign(this,{canvas,drag,zoom,pick,customZoom});this.reset();
    canvas.addEventListener('pointerdown',e=>this.down(e));
    canvas.addEventListener('pointermove',e=>this.move(e));
    canvas.addEventListener('pointerup',e=>this.up(e));
    canvas.addEventListener('pointercancel',e=>this.up(e,true));
    canvas.addEventListener('lostpointercapture',e=>this.up(e,true));
    window.addEventListener('blur',()=>this.reset());
  }
  reset(){this.points=new Map();this.pinched=false;this.distance=0;}
  span(){const [a,b]=this.points.values();return b?Math.hypot(a.x-b.x,a.y-b.y):0;}
  down(e){
    if(e.button!==0)return;
    this.points.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:0});
    this.canvas.setPointerCapture(e.pointerId);
    if(this.points.size>1){this.pinched=true;this.distance=this.span();}
  }
  move(e){
    const p=this.points.get(e.pointerId);if(!p)return;
    const dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;
    p.moved=Math.max(p.moved,Math.hypot(p.x-p.startX,p.y-p.startY));
    if(this.points.size>1){const distance=this.span();if(this.distance&&distance&&this.customZoom())this.zoom((this.distance-distance)*3);this.distance=distance;}
    else if(!this.pinched)this.drag(dx,dy);
  }
  up(e,cancelled=false){
    const p=this.points.get(e.pointerId);if(!p)return;
    if(!cancelled&&!this.pinched&&p.moved<6)this.pick(e.clientX,e.clientY);
    this.points.delete(e.pointerId);
    if(!this.points.size)this.reset();
  }
}
