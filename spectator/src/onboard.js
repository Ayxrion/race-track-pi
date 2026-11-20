import * as THREE from 'three';

export const isOnboard = angle => ['roof','bonnet','bumper','rear'].includes(angle);

// Mounts sit outside opaque glazing. Attachment follows the displayed pose exactly,
// so smoothing cannot drag the camera through the body during a corner.
export function onboardMount(roster, angle) {
  const L=roster.len, cls=roster.cls, roof=[3.5,3.8,4.15,4.55,3.3,6.95][cls];
  if(cls===6||cls===7){
    if(angle==='bonnet')return {x:L*.35,y:cls===6?3.85:1.5,reverse:false};
    if(angle==='bumper')return {x:L*.57,y:cls===6?1.2:.7,reverse:false};
    if(angle==='rear')return {x:-L*.57,y:cls===6?2.5:1.0,reverse:true};
    return {x:cls===6?.98:-.86,y:cls===6?4.85:3.85,reverse:false};
  }
  if(angle==='bonnet')return {x:L*.32,y:cls===5?4.1:cls===0||cls===4?1.9:2.95,reverse:false};
  if(angle==='bumper')return {x:L*.56,y:1.15,reverse:false};
  if(angle==='rear')return {x:-L*.56,y:1.8,reverse:true};
  return {x:0,y:roof,reverse:false};
}

export function updateOnboard(camera,pose,roster,angle,yaw=0,pitch=0) {
  const mount=onboardMount(roster,angle),h=pose[3];
  camera.position.set(pose[1]+Math.cos(h)*mount.x,mount.y+.1,pose[2]+Math.sin(h)*mount.x);
  const heading=h+(mount.reverse?Math.PI:0)+yaw;
  const aim=camera.position.clone().add(new THREE.Vector3(Math.cos(heading)*Math.cos(pitch)*70,Math.sin(pitch)*70,Math.sin(heading)*Math.cos(pitch)*70));
  camera.lookAt(aim);
  return new THREE.Vector3(pose[1],0,pose[2]);
}
