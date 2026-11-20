import * as THREE from 'three';

// All details share the chassis builder, so fairings, frame, rider and mechanical
// parts are merged by material. Wheels remain separate for telemetry animation.
function oval(b,position,scale,material){
  const g=new THREE.SphereGeometry(1,20,12);g.scale(...scale);b.add(g,material,position);
}
// Rounded sections interpolate smoothly along the length instead of forming
// eight-sided blocks. Flat end caps still provide solid lamp mounting surfaces.
function hull(b,sections,mat,offset=[0,0,0]){
  const curve=new THREE.CatmullRomCurve3(sections.map(([x,lo,hi,w])=>new THREE.Vector3(x,(lo+hi)/2,w)),false,'centripetal');
  const height=new THREE.CatmullRomCurve3(sections.map(([x,lo,hi])=>new THREE.Vector3(x,(hi-lo)/2,0)),false,'centripetal');
  const n=(sections.length-1)*6,sides=24,positions=[],indices=[],maxWidth=Math.max(...sections.map(s=>s[3]));
  for(let i=0;i<=n;i++){
    const p=curve.getPoint(i/n),h=height.getPoint(i/n).y;
    for(let j=0;j<sides;j++){const a=j*Math.PI*2/sides,c=Math.cos(a),s=Math.sin(a);positions.push(p.x,p.y+Math.sign(c)*Math.abs(c)**.72*h,Math.sign(s)*Math.abs(s)**.72*Math.min(maxWidth,p.z));}
  }
  for(let i=0;i<n;i++)for(let j=0;j<sides;j++){const a=i*sides+j,c=i*sides+(j+1)%sides;indices.push(a,c,a+sides,c,c+sides,a+sides);}
  // End-cap vertices have separate normals, retaining a crisp mounting face.
  for(const [ring,reverse] of [[0,true],[n,false]]){
    const start=positions.length/3,p=curve.getPoint(ring/n);positions.push(p.x,p.y,0);
    for(let j=0;j<sides;j++)positions.push(...positions.slice((ring*sides+j)*3,(ring*sides+j)*3+3));
    for(let j=0;j<sides;j++){const a=start+1+j,c=start+1+(j+1)%sides;indices.push(...(reverse?[start,c,a]:[start,a,c]));}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();b.add(g,mat,offset);
}
function padded(b,a,c,width,depth,mat){
  const from=new THREE.Vector3(...a),to=new THREE.Vector3(...c),delta=to.clone().sub(from);
  const g=new THREE.SphereGeometry(1,16,10);g.scale(width,delta.length()*.64,depth);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));b.add(g,mat,from.add(to).multiplyScalar(.5).toArray());
}
// Kart plastics use straight tapers, flat faces and small chamfers. Separate
// face normals retain the panel creases rather than rounding the highlights.
function angularPanel(b,sections,mat,offset=[0,0,0]){
  const vertices=[],indices=[],bevel=.035;
  for(const [x,lo,hi,w] of sections){
    const c=Math.min(bevel,(hi-lo)/4,w/4);
    for(const [y,z] of [[lo,-w+c],[lo+c,-w],[hi-c,-w],[hi,-w+c],[hi,w-c],[hi-c,w],[lo+c,w],[lo,w-c]])vertices.push(x,y,z);
  }
  for(let s=0;s<sections.length-1;s++)for(let j=0;j<8;j++){
    const a=s*8+j,n=s*8+(j+1)%8,c=a+8,d=n+8;indices.push(a,n,c,n,d,c);
  }
  const end=(sections.length-1)*8;
  for(let j=1;j<7;j++)indices.push(0,j+1,j,end,end+j,end+j+1);
  const indexed=new THREE.BufferGeometry();indexed.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));indexed.setIndex(indices);
  const flat=indexed.toNonIndexed();indexed.dispose();flat.computeVertexNormals();b.add(flat,mat,offset);
}
// Follow shaped cross-sections while retaining a crease at each moulded edge.
function mouldedShell(b,rings,material){
  const count=rings[0].length;
  for(let edge=0;edge<count;edge++){
    const p=[],indices=[];
    for(const ring of rings)p.push(...ring[edge],...ring[(edge+1)%count]);
    for(let i=0;i<rings.length-1;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(indices);g.computeVertexNormals();b.add(g,material);
  }
  for(const [ring,reverse] of [[rings[0],true],[rings.at(-1),false]]){
    const g=new THREE.BufferGeometry(),indices=[];g.setAttribute('position',new THREE.Float32BufferAttribute(ring.flat(),3));
    for(let i=1;i<count-1;i++)indices.push(...(reverse?[0,i+1,i]:[0,i,i+1]));
    g.setIndex(indices);g.computeVertexNormals();b.add(g,material);
  }
}
function kartNose(b,L,W,paint,trim,carbon){
  // z/width, front/length, rear/length, top: broad center, low shoulders,
  // then raised tips swept backwards in front of the exposed tires.
  const half=[[0,.505,.365,1.04],[.13,.502,.370,1.02],[.23,.494,.390,.87],[.33,.480,.411,.88],[.425,.460,.418,1.10],[.465,.450,.422,1.20]];
  const sections=[...half.slice(1).reverse().map(([z,...rest])=>[-z,...rest]),...half];
  const rings=sections.map(([z,front,rear,top])=>{
    const x=front*L,back=rear*L,bottom=.35+Math.abs(z)*.12;
    return [[back+.04,bottom,z*W],[x-.05,bottom,z*W],[x,bottom+.05,z*W],[x,top-.10,z*W],[x-.12,top,z*W],[back+.06,top-.04,z*W],[back,top-.12,z*W],[back,bottom+.05,z*W]];
  });
  mouldedShell(b,rings,paint);
  // Pinstripe follows the actual moulding rather than floating over its crown.
  for(let i=0;i<sections.length-1;i++){
    const [za,xa,,ya]=sections[i],[zb,xb,,yb]=sections[i+1];
    b.panel([[xa*L+.008,ya-.15,za*W],[xa*L+.008,ya-.20,za*W],[xb*L+.008,yb-.20,zb*W],[xb*L+.008,yb-.15,zb*W]],trim,true);
  }
  for(const side of [-1,1])b.rod([L*.34,.53,side*.95],[L*.408,.58,side*1.35],.065,carbon);
}
function kartCowl(b,paint,trim,alloy){
  // Tall upper number shield ahead of the steering wheel; narrow waist and toe.
  const levels=[[2.73,1.00,.25],[2.30,1.05,.27],[1.80,1.20,.32],[1.44,1.67,.60],[1.25,2.14,.63],[1.25,2.22,.50]];
  const rings=levels.map(([x,y,w])=>[[x,y,-w*.72],[x-.06,y,-w],[x-.22,y,-w*.91],[x-.25,y,w*.91],[x-.06,y,w],[x,y,w*.72]]);
  mouldedShell(b,rings,paint);
  for(const side of [-1,1]){
    b.rod([1.14,.53,side*.36],[1.24,1.70,side*.35],.045,alloy);
    for(let i=0;i<levels.length-1;i++){
      const [x,y,w]=levels[i],[nx,ny,nw]=levels[i+1];
      b.rod([x-.025,y,side*w*.82],[nx-.025,ny,side*nw*.82],.018,trim);
    }
  }
}
function helmet(b,p,r,paint,visor,trim){
  oval(b,p,[r,r*.95,r*.88],paint);
  const seal=new THREE.MeshStandardMaterial({color:0x111820,roughness:.65});
  for(const [radius,start,length,mat] of [[1.014,.90,.91,seal],[1.025,.98,.70,visor]]){
    const g=new THREE.SphereGeometry(r*radius,24,12,Math.PI-1.1,2.2,start,length);g.scale(1,.95,.88);b.add(g,mat,p);
  }
  // Projecting chin guard, padded neck opening, intake slots and visor pivots.
  hull(b,[[p[0]+r*.35,p[1]-r*.70,p[1]-r*.30,r*.66],[p[0]+r*.95,p[1]-r*.61,p[1]-r*.22,r*.47]],paint,[0,0,p[2]]);
  for(const side of [-1,1]){
    b.box(p[0]+r*.96,p[1]-r*.39,p[2]+side*r*.25,.025,r*.12,r*.22,seal,.01);
    oval(b,[p[0]+r*.18,p[1]+r*.03,p[2]+side*r*.86],[r*.12,r*.12,.025],trim);
  }
  const stripe=new THREE.SphereGeometry(r*1.012,12,16,Math.PI-.09,.18,.05,.83);stripe.scale(1,.95,.88);b.add(stripe,trim,p);
  oval(b,[p[0],p[1]-r*.79,p[2]],[r*.65,r*.17,r*.61],seal);
}
function limb(b,a,j,c,r,material,glove){
  padded(b,a,j,r*1.10,r*.94,material);oval(b,j,[r*.92,r*.92,r*.92],material);padded(b,j,c,r*.82,r*.78,material);oval(b,c,[r*1.10,r*.85,r*.85],glove);
}

export function buildLightWheel(b,d,front,m,bike){
  const {R}=d,{rubber,carbon,alloy,trim}=m,width=bike?(front?.48:.68):(front?.68:.96);
  const profile=bike?[[.60,-.50],[.77,-.50],[.94,-.30],[1,-.08],[1,.08],[.94,.30],[.77,.50],[.60,.50],[.60,-.50]]:
    [[.57,-.50],[.87,-.50],[.97,-.42],[1,-.32],[1,.32],[.97,.42],[.87,.50],[.57,.50],[.57,-.50]];
  const g=new THREE.LatheGeometry(profile.map(([r,z])=>new THREE.Vector2(r*R,z*width)),32);b.add(g,rubber,[0,0,0],[Math.PI/2,0,0]);
  for(const side of [-1,1]){
    const face=side*width*.47;
    b.add(new THREE.TorusGeometry(R*.60,bike?.045:.035,6,32),alloy,[0,0,face]);
    b.add(new THREE.TorusGeometry(R*.66,.015,4,32),carbon,[0,0,face]);
    for(let i=0;i<(bike?7:5);i++){
      const a=i*Math.PI*2/(bike?7:5),hub=[Math.cos(a)*R*.15,Math.sin(a)*R*.15,face*.45],end=[Math.cos(a+.12)*R*.58,Math.sin(a+.12)*R*.58,face];
      b.rod(hub,end,bike?.045:.055,alloy);
    }
    b.add(new THREE.CylinderGeometry(R*.16,R*.16,.12,16),alloy,[0,0,face],[Math.PI/2,0,0]);
    b.add(new THREE.CylinderGeometry(R*.075,R*.075,.14,6),carbon,[0,0,face+side*.03],[Math.PI/2,0,0]);
    b.box(0,R*.83,side*width*.505,R*.15,R*.075,.012,trim,.003);
    if(bike){
      const discZ=face+side*.075;
      const disc=new THREE.RingGeometry(R*.29,R*.49,32);b.add(disc,alloy,[0,0,discZ],[0,side>0?0:Math.PI,0]);
      for(let i=0;i<16;i++){
        const a=i*Math.PI/8,r=R*(i%2?.44:.38);
        b.add(new THREE.CircleGeometry(.027,6),carbon,[Math.cos(a)*r,Math.sin(a)*r,discZ+side*.006],[0,side>0?0:Math.PI,0]);
      }
    }
  }
  return width;
}

export function buildMotorcycle(b,d,m){
  const {L,R,wheelX}=d,{paint,trim,accent,carbon,alloy,glass,rubber}=m;
  const gold=new THREE.MeshStandardMaterial({color:0xb99546,roughness:.29,metalness:.8});
  const suit=new THREE.MeshStandardMaterial({color:0x273039,roughness:.84}),fabric=new THREE.MeshStandardMaterial({color:paint.color,roughness:.88});
  // Engine cases, trellis frame and rear swingarm connect both axles to the body.
  b.box(-.2,1.48,0,1.9,1.12,.85,alloy,.24);
  for(const side of [-1,1]){
    const z=side*.49;
    b.add(new THREE.CylinderGeometry(.43,.43,.18,20),carbon,[-.12,1.3,z],[Math.PI/2,0,0]);
    b.rod([-wheelX,R,side*.38],[-.4,1.55,side*.38],.14,alloy);
    b.rod([-.4,1.55,side*.38],[1.30,2.95,side*.40],.12,alloy);
    b.rod([-1.5,2.35,z],[1.30,2.95,side*.40],.10,accent);
    b.rod([-1.5,2.35,z],[-.4,1.55,side*.38],.10,accent);
    b.rod([1.4,2.90,side*.33],[wheelX,R,side*.33],.105,gold);
    b.rod([2.1,1.98,side*.33],[wheelX,R,side*.33],.145,alloy);
    b.rod([1.4,2.9,-.33],[1.4,2.9,.33],.10,carbon);
    // Footrests and clip-on bars are attached to the frame/fork head.
    b.rod([-.7,1.40,side*.4],[-.7,1.40,side*.83],.09,carbon);
    b.rod([1.40,2.95,side*.30],[1.65,2.95,side*.88],.075,alloy);
    b.rod([1.65,2.95,side*.70],[1.65,2.95,side*.98],.10,rubber);
  }
  b.rod([-.7,1.4,0],[-1.55,2.45,0],.12,alloy);
  const spring=new THREE.CatmullRomCurve3(Array.from({length:73},(_,i)=>{const u=i/72,a=u*Math.PI*12;return new THREE.Vector3(-.7-.85*u+Math.cos(a)*.16,1.4+1.05*u,Math.sin(a)*.16);}));
  b.add(new THREE.TubeGeometry(spring,72,.035,5,false),gold);
  // Lower belly pan, tank and swept tail. Keep the front wheel opening clear.
  hull(b,[[-1.6,.77,1.30,.35],[-.7,.58,2.05,.67],[.65,.62,2.40,.71],[1.3,1.3,2.8,.58],[1.55,2.08,3.03,.48]],paint);
  hull(b,[[-1.25,2.10,2.50,.42],[-.35,2.10,2.96,.65],[.42,2.12,3.08,.62],[1.1,2.15,2.78,.38]],paint);
  hull(b,[[-L*.43,2.30,2.65,.22],[-2.65,2.28,2.91,.38],[-1.85,2.22,2.76,.48],[-.85,2.18,2.48,.43]],paint);
  b.box(-1.25,2.52,0,1.35,.19,.84,carbon,.15);
  hull(b,[[1.05,2.22,3.25,.65],[1.80,2.46,3.43,.63],[L*.30,2.62,3.22,.49]],paint);
  hull(b,[[.95,3.21,3.35,.46],[1.23,3.27,3.62,.46],[1.65,3.30,3.64,.40],[2.20,3.19,3.30,.29]],glass);
  b.box(.38,3.07,0,.30,.035,.30,alloy,.10);
  b.box(1.30,2.98,0,.25,.25,.52,carbon,.06,[0,0,-.35]);
  b.box(1.20,3.04,0,.018,.13,.36,glass,.02,[0,0,-.35]);
  for(const side of [-1,1]){
    b.box(.50,1.23,side*.70,1.05,.60,.07,paint,.08);
    b.box(-.55,1.02,side*.54,1.1,.13,.19,trim,.04,[0,0,-.18]);
    for(let k=0;k<3;k++)b.box(.90-k*.24,2.17-k*.06,side*.66,.11,.31,.13,carbon,.04,[0,0,-.45]);
    b.rod([1.07,3.1,side*.50],[1.15,3.36,side*.82],.055,carbon);
    b.box(1.16,3.36,side*.88,.36,.17,.27,carbon,.07);
    b.box(1.16-.18,3.36,side*.88,.018,.11,.20,alloy,.02);
  }
  // Front fender is a curved shell over the tire, supported by the fork legs.
  const fender=new THREE.BufferGeometry(),fp=[],fi=[];
  for(let i=0;i<=24;i++)for(let j=0;j<=8;j++){
    const a=-.98+i/24*1.96,z=(j/8*2-1)*.34,r=R+.08+.07*(1-(z/.34)**2);
    fp.push(wheelX+Math.sin(a)*r,R+Math.cos(a)*r,z);
  }
  for(let i=0;i<24;i++)for(let j=0;j<8;j++){const a=i*9+j;fi.push(a,a+1,a+9,a+1,a+10,a+9);}
  fender.setAttribute('position',new THREE.Float32BufferAttribute(fp,3));fender.setIndex(fi);fender.computeVertexNormals();b.add(fender,paint);
  // Exhaust joins the engine, follows the underside and rises to a silencer.
  b.rod([.60,1.15,.4],[.35,.72,.69],.12,alloy);
  b.rod([.35,.72,.69],[-1.65,.83,.79],.12,alloy);
  b.rod([-1.65,.83,.79],[-2.8,1.42,.79],.20,carbon);
  for(const u of [.15,.83]){const x=-1.65-1.15*u,y=.83+.59*u;b.rod([x-.07,y-.035,.79],[x+.07,y+.035,.79],.215,alloy);}
  b.rod([-2.8,1.42,.79],[-2.93,1.49,.79],.15,alloy);
  b.rod([-2.93,1.49,.79],[-2.96,1.51,.79],.10,carbon);
  // Chain runs between the rear sprocket and engine drive sprocket.
  for(const dy of [-.24,.24])b.rod([-wheelX,R+dy,-.40],[-.4,1.3+dy,-.40],.035,carbon);
  b.add(new THREE.CylinderGeometry(.36,.36,.07,20),alloy,[-wheelX,R,-.39],[Math.PI/2,0,0]);
  // Rider: tucked shoulders, bent elbows, knees around the tank, boots on pegs.
  oval(b,[-1.02,2.72,0],[.42,.30,.43],suit);
  padded(b,[-1.02,2.75,0],[.24,3.38,0],.37,.44,fabric);
  for(const side of [-1,1]){
    limb(b,[.23,3.39,side*.40],[.97,3.10,side*.78],[1.65,2.95,side*.86],.17,fabric,carbon);
    oval(b,[.28,3.39,side*.42],[.23,.18,.20],fabric);
    limb(b,[-.90,2.70,side*.36],[.10,1.98,side*.76],[-.68,1.48,side*.72],.23,suit,carbon);
    b.box(-.52,1.48,side*.74,.62,.24,.32,carbon,.10);
    oval(b,[.08,1.98,side*.88],[.24,.22,.08],accent);
  }
  b.rod([.24,3.38,0],[.65,3.63,0],.20,suit);
  helmet(b,[.96,3.83,0],.49,paint,glass,trim);
}

export function buildKart(b,d,m){
  const {L,W,R,wheelX,wheelZ}=d,{paint,trim,accent,carbon,alloy,glass,rubber}=m;
  const suit=new THREE.MeshStandardMaterial({color:0x303940,roughness:.86}),fabric=new THREE.MeshStandardMaterial({color:paint.color,roughness:.88}),piping=new THREE.MeshStandardMaterial({color:trim.color,roughness:.9});
  // Low welded frame, floor tray, transverse axles and bumper loops.
  for(const side of [-1,1]){
    const z=side*W*.26;
    b.rod([-L*.39,.52,z],[L*.34,.52,z],.10,accent);
    b.rod([L*.34,.52,z],[L*.44,.52,side*W*.35],.10,accent);
    b.rod([-L*.39,.52,z],[-L*.44,.52,side*W*.35],.10,accent);
    b.rod([-wheelX,R,0],[-wheelX,R,side*wheelZ],.09,alloy);
    b.rod([wheelX-.20,.52,side*.8],[wheelX,R,side*wheelZ],.075,alloy);
    b.rod([wheelX-.32,.69,side*.2],[wheelX-.12,.69,side*wheelZ],.045,alloy);
    // Side pods sit between the wheels on frame outriggers.
    b.rod([-.45,.52,z],[-.45,.52,side*W*.40],.09,accent);
    angularPanel(b,[[-1.55,.44,.86,.32],[-1.19,.40,1.02,.49],[.75,.40,1.02,.49],[1.12,.46,.85,.32]],paint,[0,0,side*W*.38]);
    b.box(-.22,.77,side*(W*.38+.49),1.40,.48,.045,paint,.008);
    b.box(-.22,.43,side*W*.38,2.25,.16,.83,carbon,.015);
    b.rod([-L*.44,.52,side*W*.35],[-L*.46,.66,side*W*.39],.11,carbon);
  }
  b.rod([-L*.46,.66,-W*.39],[-L*.46,.66,W*.39],.12,carbon);
  b.rod([L*.44,.52,-W*.35],[L*.44,.52,W*.35],.11,accent);
  b.box(.25,.47,0,L*.66,.09,W*.47,carbon,.05);
  b.rod([-1.38,.52,-1.3],[1.15,.52,1.3],.075,accent);
  b.rod([-1.38,.52,1.3],[1.15,.52,-1.3],.075,accent);
  for(const side of [-1,1]){
    b.rod([.6,.54,side*1.15],[1.45,.54,side*.85],.075,accent);
    b.rod([1.45,.54,side*.85],[2.07,.64,side*1.87],.055,alloy);
    b.box(-wheelX,.72,side*.96,.27,.25,.32,alloy,.04);
    b.add(new THREE.CylinderGeometry(.16,.16,.12,12),alloy,[-wheelX,.72,side*1.08],[Math.PI/2,0,0]);
  }
  kartNose(b,L,W,paint,trim,carbon);
  kartCowl(b,paint,trim,alloy);
  // Seat shell, rear engine, finned cylinder, airbox and exhaust.
  b.box(-.83,.94,0,1.35,.23,1.18,carbon,.19);
  b.box(-1.37,1.48,0,.25,1.34,1.15,carbon,.12,[0,0,-.28]);
  for(const side of [-1,1]){
    hull(b,[[-1.53,1.00,1.78,.13],[-1.10,.88,1.39,.12],[-.30,.90,1.12,.10]],carbon,[0,0,side*.54]);
    b.rod([-1.65,.55,side*.7],[-1.43,1.69,side*.53],.055,alloy);
    b.add(new THREE.SphereGeometry(.055,8,6),alloy,[-1.35,1.7,side*.59]);
  }
  b.box(-1.66,1.06,.96,1.15,.85,.72,alloy,.12);
  for(let i=0;i<6;i++)b.box(-1.66,1.25+i*.085,.96,.65,.045,.76,carbon,.01);
  b.box(-1.66,1.75,.96,.50,.08,.57,alloy,.035);
  b.rod([-1.66,1.78,.96],[-1.66,1.94,.96],.045,trim);
  const cable=new THREE.CatmullRomCurve3([new THREE.Vector3(-1.66,1.94,.96),new THREE.Vector3(-1.95,2.03,1.05),new THREE.Vector3(-2.18,1.12,1.10)]);
  b.add(new THREE.TubeGeometry(cable,12,.035,5,false),rubber);
  b.add(new THREE.CylinderGeometry(.30,.30,.12,16),carbon,[-1.68,1.02,1.39],[Math.PI/2,0,0]);
  for(let i=0;i<6;i++){const a=i*Math.PI/3;b.add(new THREE.SphereGeometry(.045,6,4),alloy,[-1.68+Math.cos(a)*.23,1.02+Math.sin(a)*.23,1.46]);}
  b.box(-1.12,1.21,1.20,.54,.47,.45,carbon,.12);
  b.rod([-1.9,1.16,1.12],[-2.52,1.27,1.00],.12,alloy);
  b.rod([-2.52,1.27,1.00],[-2.74,1.35,.14],.21,carbon);
  b.rod([-2.74,1.35,.14],[-2.74,1.35,-.40],.12,alloy);
  b.add(new THREE.CylinderGeometry(.32,.32,.06,20),alloy,[-wheelX,R,.87],[Math.PI/2,0,0]);
  for(const dy of [-.2,.2])b.rod([-wheelX,R+dy,.90],[-1.52,.95+dy,.90],.035,carbon);
  // Fuel tank between the driver's knees, pedal rails and steering column.
  b.box(.53,.92,0,.56,.77,.52,trim,.13);
  b.box(.53,1.33,0,.16,.08,.20,carbon,.03);
  for(const side of [-1,1])b.rod([1.3,.51,side*.43],[1.77,.75,side*.43],.055,alloy);
  const columnA=[.52,.54,0],columnB=[.82,1.81,0];b.rod(columnA,columnB,.065,alloy);
  const direction=new THREE.Vector3(...columnB).sub(new THREE.Vector3(...columnA)).normalize();
  const wheel=new THREE.TorusGeometry(.46,.065,8,24);wheel.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),direction));b.add(wheel,rubber,columnB);
  b.rod([.82,1.81,-.44],[.82,1.81,.44],.04,alloy);
  // Driver seated inside the frame with hands on the wheel and feet on pedals.
  oval(b,[-.77,1.17,0],[.39,.25,.40],suit);
  padded(b,[-.77,1.17,0],[-1.14,2.18,0],.34,.38,fabric);
  b.rod([-.78,1.35,-.28],[-1.08,2.11,-.28],.025,trim);
  b.rod([-.78,1.35,.28],[-1.08,2.11,.28],.025,trim);
  for(const side of [-1,1]){
    limb(b,[-1.09,2.17,side*.38],[-.21,1.64,side*.66],[.82,1.81,side*.43],.16,fabric,carbon);
    oval(b,[-1.02,2.18,side*.39],[.21,.17,.19],fabric);
    limb(b,[-.63,1.13,side*.32],[.55,1.05,side*.46],[1.64,.68,side*.43],.21,suit,carbon);
    b.box(1.69,.67,side*.43,.52,.25,.35,carbon,.09);
  }
  b.rod([-1.14,2.18,0],[-1.02,2.50,0],.17,suit);
  helmet(b,[-.94,2.81,0],.48,paint,glass,trim);
}
