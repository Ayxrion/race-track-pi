// Reuse the desktop controls in a native modal sheet: one set of event handlers,
// with focus trapping, Escape and inert background behavior supplied by <dialog>.
export class MobilePanels {
  constructor() {
    this.dialog=document.getElementById('mobile-sheet');
    this.content=document.getElementById('sheet-content');
    this.media=matchMedia('(max-width:900px), (max-height:520px)');
    this.panels=new Map(['camera','timing'].map(name=>{
      const panel=document.getElementById(`${name}-panel`),anchor=document.createComment(`${name} panel`);
      panel.before(anchor);return [name,{panel,anchor}];
    }));
    document.getElementById('camera-open').onclick=()=>this.open('camera');
    document.getElementById('drivers-open').onclick=()=>this.open('timing');
    document.getElementById('sheet-close').onclick=()=>this.close();
    this.dialog.addEventListener('close',()=>{if(!this.dialog.open)this.restore();});
    this.media.addEventListener('change',()=>{if(!this.media.matches)this.close();});
    for(const id of ['mobile-sheet','connect-dialog','classification']) {
      const dialog=document.getElementById(id);
      dialog.addEventListener('click',e=>{
        const r=dialog.getBoundingClientRect();
        if(e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))dialog.close();
      });
    }
  }
  open(name) {
    if(!this.media.matches)return;
    this.close();
    document.getElementById('sheet-title').textContent=name==='camera'?'Choose your view':'Drivers & positions';
    this.content.append(this.panels.get(name).panel);
    this.dialog.showModal();
  }
  restore(){for(const {panel,anchor} of this.panels.values())if(panel.parentElement===this.content)anchor.after(panel);}
  close(){if(this.dialog.open)this.dialog.close();this.restore();}
  quickChoice(){if(this.media.matches)this.close();}
  ready(value){for(const id of ['camera-open','drivers-open'])document.getElementById(id).disabled=!value;}
}
