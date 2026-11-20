// Body profiles and lamp mounts share one dimensional description. X is forward.
export function vehicleDesign(r){
  const L=r.len,W=r.wid,open=r.cls===0||r.cls===4,van=r.cls===5;
  if(r.cls===6)return {L,W,R:1.18,wheelX:L*.32,wheelZ:0,tireWidth:.60,halfWidth:.67,roof:4.65,lamps:[
    ...[-1,1].map(side=>({kind:'head',x:L*.30,y:2.91,z:side*.29,width:.36,height:.16})),
    {kind:'tail',x:-L*.43,y:2.47,z:0,width:.34,height:.19},
  ]};
  if(r.cls===7)return {L,W,R:.62,wheelX:L*.30,wheelZ:W*.40,tireWidth:.80,halfWidth:W*.48,roof:3.60,lamps:[
    ...[-1,1].flatMap(side=>[
      {kind:'head',x:L*.494,y:.59,z:side*W*.23,width:.30,height:.16},
      {kind:'tail',x:-L*.46,y:.66,z:side*W*.30,width:.30,height:.20},
    ]),
  ]};
  const R=W*(r.cls===0?.215:r.cls===4?.205:.17),wheelX=L*(open||van?.31:.30);
  const design={L,W,R,wheelX,wheelZ:W*(open?.40:.385),tireWidth:W*(open?.205:.14),halfWidth:W*.46,roof:r.cls===5?6.25:r.cls===3?3.9:3.5};
  const lamps=[];
  const pair=(kind,x,y,z,width,height,round=false,anchor=null)=>{for(const side of [-1,1])lamps.push({kind,x,y,z:side*z,width,height,round,anchor:anchor?[anchor[0],anchor[1],side*anchor[2]]:null});};
  if(r.cls===0){
    pair('head',L*.465,1.05,W*.27,.42,.34,true,[L*.455,.79,W*.27]);
    lamps.push({kind:'tail',x:-L*.43,y:1.12,z:0,width:.48,height:.42});
  }else if(r.cls===4){
    pair('head',L*.40,1.32,W*.24,.55,.55,true,[L*.34,1.05,W*.14]);
    lamps.push({kind:'tail',x:-L*.48,y:1.05,z:0,width:.33,height:.33,round:true});
  }else{
    const top=van?[[-.48,5.95],[-.42,6.25],[.17,6.25],[.34,3.55],[.48,2.4]]:
      [[-.48,r.cls===1?1.9:1.75],[-.38,2.55],[-.23,2.55],[-.15,2.12],[.15,2.12],[.24,2.55],[.37,2.55],[.48,r.cls===1?1.95:1.7]];
    design.bodyTop=top.map(([x,y])=>[x*L,y]);design.bodyBottom=.58;
    pair('head',L*.48,van?2.02:r.cls===1?1.38:1.30,W*.31,W*(van?.19:.18),van?.52:r.cls===1?.70:.40);
    pair('tail',-L*.48,van?2.85:1.35,W*(van?.385:.31),W*(van?.075:.17),van?1.85:.35);
  }
  return {...design,lamps};
}
