import * as THREE from 'three';

export function weatherIntensity(weather){return weather===4?1:weather===3?.6:weather===5?.65:0;}
export function sprayAmount(pose,wet){return pose&&!pose[7]?THREE.MathUtils.clamp((Math.abs(pose[4])-4)/70,0,1)*wet:0;}

const shelterShader=`uniform vec4 shelters[4];uniform vec2 shelterSizes[4];uniform int shelterCount;
float exposedHeight(vec3 p){for(int i=0;i<4;i++){if(i>=shelterCount)break;vec2 d=p.xz-shelters[i].xy;float along=dot(d,shelters[i].zw);float across=dot(d,vec2(-shelters[i].w,shelters[i].z));if(abs(along)<shelterSizes[i].x&&abs(across)<shelterSizes[i].y&&p.y<18.8)return -1.;}return p.y;}`;

// Fixed particle pools keep cost independent of circuit size. Motion uses race time,
// so suspended telemetry freezes the weather and spray along with the cars.
export class WeatherEffects {
  constructor(world,track,at){
    this.group=new THREE.Group();world.add(this.group);this.enabled=true;
    const seeds=[],ends=[];for(let i=0;i<1000;i++)for(let end=0;end<2;end++){seeds.push((i*.61803398875%1)*220,(i*.41421356237%1)*100,(i*.73205080757%1)*220);ends.push(end);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(seeds,3));geo.setAttribute('end',new THREE.Float32BufferAttribute(ends,1));
    this.uniforms={time:{value:0},eye:{value:new THREE.Vector3()},strength:{value:0},light:{value:1}};
    const covered=track.stands.filter((_,i)=>i%3===0),shelters=Array.from({length:4},()=>new THREE.Vector4()),sizes=Array.from({length:4},()=>new THREE.Vector2());
    covered.forEach((st,i)=>{const q=at(st.sc,(st.side?1:-1)*(st.d0+st.d1)/2);shelters[i].set(q.x,q.z,Math.cos(q.h),Math.sin(q.h));sizes[i].set(st.half,(st.d1-st.d0)/2+2.5);});
    Object.assign(this.uniforms,{shelters:{value:shelters},shelterSizes:{value:sizes},shelterCount:{value:covered.length}});
    this.rain=new THREE.LineSegments(geo,new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:this.uniforms,
      vertexShader:shelterShader+`attribute float end; uniform float time; uniform vec3 eye; varying float height; void main(){vec3 p=position; p.x=mod(p.x-time*8.-eye.x+110.,220.)-110.+eye.x; p.z=mod(p.z-eye.z+110.,220.)-110.+eye.z; p.y=mod(p.y-time*88.-eye.y+50.,100.)-50.+eye.y; p+=vec3(.35,3.2,0.)*end; height=exposedHeight(p); gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}`,
      fragmentShader:`uniform float strength; uniform float light; varying float height; void main(){if(height<.2)discard;gl_FragColor=vec4(vec3(.65,.78,.86)*light,.32*strength);}`
    }));this.rain.frustumCulled=false;this.group.add(this.rain);
    const snowGeo=new THREE.BufferGeometry();snowGeo.setAttribute('position',new THREE.Float32BufferAttribute(seeds.filter((_,i)=>Math.floor(i/3)%2===0),3));
    this.snow=new THREE.Points(snowGeo,new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:this.uniforms,
      vertexShader:shelterShader+`uniform float time;uniform vec3 eye;varying float height;void main(){vec3 p=position;p.x=mod(p.x+sin(time*.6+p.z)*3.-time*2.-eye.x+110.,220.)-110.+eye.x;p.z=mod(p.z-eye.z+110.,220.)-110.+eye.z;p.y=mod(p.y-time*9.-eye.y+50.,100.)-50.+eye.y;height=exposedHeight(p);vec4 mv=viewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(180./max(1.,-mv.z),1.,6.);}`,
      fragmentShader:`uniform float light;varying float height;void main(){float d=length(gl_PointCoord-.5);if(d>.5||height<.2)discard;gl_FragColor=vec4(vec3(.9,.95,1.)*light,.7*(1.-d*2.));}`
    }));this.snow.frustumCulled=false;this.group.add(this.snow);
    this.sprayPositions=new Float32Array(21*36*3);const sprayGeo=new THREE.BufferGeometry();sprayGeo.setAttribute('position',new THREE.BufferAttribute(this.sprayPositions,3).setUsage(THREE.DynamicDrawUsage));sprayGeo.setDrawRange(0,0);
    this.spray=new THREE.Points(sprayGeo,new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{light:this.uniforms.light},
      vertexShader:`void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(800./max(1.,-mv.z),2.,45.);}`,
      fragmentShader:`uniform float light;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(vec3(.7,.77,.8)*light,.10*pow(1.-d*2.,2.));}`
    }));this.spray.frustumCulled=false;this.group.add(this.spray);
    const puddleMaterial=new THREE.MeshPhysicalMaterial({color:0x596c74,roughness:.18,metalness:.35,clearcoat:.6,envMapIntensity:.35,transparent:true,opacity:0,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
    this.puddles=new THREE.InstancedMesh(new THREE.CircleGeometry(1,16),puddleMaterial,40);const dummy=new THREE.Object3D();
    for(let i=0;i<40;i++){const q=at(track.L*(i+.37)/40,Math.sin(i*7.3)*track.width*.32);dummy.position.set(q.x,.045,q.z);dummy.rotation.set(-Math.PI/2,0,q.h);dummy.scale.set(2+i%5,.8+(i%3)*.4,1);dummy.updateMatrix();this.puddles.setMatrixAt(i,dummy.matrix);}
    this.group.add(this.puddles);
  }
  update(frame,camera,roster){
    this.group.visible=this.enabled&&!!frame;if(!this.enabled||!frame)return;
    this.uniforms.time.value=frame.t;this.uniforms.eye.value.copy(camera.position);this.uniforms.strength.value=weatherIntensity(frame.weather);this.uniforms.light.value=1-frame.night*.65;
    this.rain.visible=frame.weather===3||frame.weather===4;this.snow.visible=frame.weather===5;
    this.puddles.visible=frame.wet>.08;this.puddles.material.opacity=frame.wet*.42;
    let count=0;
    for(const p of frame.cars){const amount=sprayAmount(p,frame.wet);if(amount<.03)continue;const r=roster.get(p[0]);if(!r)continue;
      const cos=Math.cos(p[3]),sin=Math.sin(p[3]);
      for(let i=0;i<Math.floor(amount*36);i++){const age=((i*.618+frame.t*1.2)%1),behind=r.len*.45+age*(6+amount*18),side=(i%2?1:-1)*(r.wid*.36+age*2)+Math.sin(i*3.4)*age*2;
        this.sprayPositions[count++]=p[1]-cos*behind-sin*side;this.sprayPositions[count++]=.4+age*3+Math.sin(i*8.1+frame.t)*age*.4;this.sprayPositions[count++]=p[2]-sin*behind+cos*side;
      }
    }
    this.spray.geometry.setDrawRange(0,count/3);this.spray.geometry.attributes.position.needsUpdate=true;
  }
}
