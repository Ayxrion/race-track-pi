export const driverName = roster => typeof roster?.name==='string'&&roster.name.trim()?roster.name.slice(0,48):roster?.code??'Unknown';
export const driverStatus = (pose,position) => !pose?'Unavailable':pose[7]?'Retired':pose[11]?'Finished':pose[6]>0?'In pit lane':position===1?'Leader':pose[12]<0?`${Math.abs(Math.round(pose[12]))} lap behind`:`+${pose[12].toFixed(1)}s`;

export function broadcastState(frame,manifest,selected=-1) {
  const poses=new Map(frame.cars.map(p=>[p[0],p])),roster=new Map(manifest.roster.map(r=>[r.id,r]));
  const order=frame.order.filter(id=>roster.has(id)&&!roster.get(id).safety);
  const rows=order.map((id,index)=>({id,position:index+1,name:driverName(roster.get(id)),number:roster.get(id).num??id+1,status:frame.phase===0?'Grid position':driverStatus(poses.get(id),index+1)}));
  const leader=rows[0],driver=rows.find(r=>r.id===selected);
  return {
    phase:['STARTING GRID','RACE IN PROGRESS','CHEQUERED FLAG','RACE RESULTS'][frame.phase],
    lap:frame.laps?`LAP ${frame.lap} / ${frame.laps}`:`LAP ${frame.lap}`,
    headline:frame.phase===0?'The grid is forming':frame.phase===2?'The field takes the flag':frame.phase===3?'Final classification':frame.laps&&frame.lap===frame.laps?'Final lap':frame.series,
    // Race-control text is supplied by the device, never inferred from car motion.
    event:frame.event,
    rows,driver,leader,
    classification:frame.phase===0||frame.phase===3,
  };
}
