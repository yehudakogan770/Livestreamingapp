// The Stage Visuals Live shaders (modules/stage-visuals), unchanged.
export const VS = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
export const SCENE_FS = `
precision highp float;
uniform vec2 uRes; uniform float uBeat; uniform float uPulse; uniform float uMix;
uniform float uB0; uniform float uB1; uniform float uB2;
uniform int uM0; uniform int uM1; uniform int uM2; uniform mat3 uP0; uniform mat3 uP1; uniform mat3 uP2;
uniform float uS0; uniform float uS1; uniform float uS2; uniform float uF0; uniform float uF1; uniform float uF2;
uniform float uK0; uniform float uK1; uniform float uK2; uniform float uOv; uniform float uOvMode;
uniform float uZoom; uniform float uRot; uniform vec2 uPan; uniform float uKal; uniform float uMirror;
#define PI 3.14159265
#define TAU 6.2831853
float h1(float n){return fract(sin(n*12.9898)*43758.5453);}
float hv(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hv(i),hv(i+vec2(1.,0.)),f.x),mix(hv(i+vec2(0.,1.)),hv(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*vnoise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
vec3 pal(mat3 P,float t){t=fract(t);
  if(t<.3333) return mix(P[0],P[1],t*3.);
  if(t<.6667) return mix(P[1],P[2],(t-.3333)*3.);
  return mix(P[2],P[0],(t-.6667)*3.);}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}

// tb = this scene's own beat clock, spd = its speed-scaled phase (both advance smoothly, never jump)
vec3 scene(int m, vec2 uv, float tb, float spd, float pu, mat3 P){
  float z0=spd; vec3 col=vec3(0.); float bright=1.+pu*1.6;
  if(m<=5){ uv+=vec2(sin(tb*PI/8.),cos(tb*PI/12.))*.07; uv=rot(sin(tb*PI/16.)*.35)*uv; }
  float a=atan(uv.y,uv.x); float L=length(uv); float r=L;

  if(m==0){ // neon rings
    float d=.35/r, z=d+z0, f=fract(z), e=min(f,1.-f);
    col=pal(P,floor(z)*.17)*exp(-e*16.)*bright;
    col+=pal(P,floor(z)*.17+.5)*pow(abs(cos(a*4.+floor(z))),60.)*.35*exp(-e*3.);
  } else if(m==1){ // square corridor
    vec2 q=abs(uv); r=max(q.x,q.y);
    float d=.35/r, z=d+z0, f=fract(z), e=min(f,1.-f);
    float s=q.x>q.y?uv.y/q.x:uv.x/q.y; float es=abs(fract(s*2.+.5)-.5);
    col=pal(P,floor(z)*.13+s*.08)*(exp(-e*18.)*bright+exp(-es*30.)*.45+exp(-abs(q.x-q.y)/r*25.)*.8);
  } else if(m==2){ // checker warp
    float d=.35/r; float u=a/TAU*12.+d*.6+tb*.125, v=d*2.+z0*2.;
    float c=mod(floor(u)+floor(v),2.);
    float edge=min(min(fract(u),1.-fract(u)),min(fract(v),1.-fract(v)));
    col=mix(P[0]*.12,pal(P,floor(v)*.1)*.9,c)*bright+P[1]*exp(-edge*25.)*.7;
  } else if(m==3){ // spiral
    float d=.35/r; float sp=fract(a/TAU*4.+d*1.2-z0*.5); float e=min(sp,1.-sp);
    col=pal(P,d*.05+sp*.3-tb*.03)*exp(-e*9.)*bright;
    float f=fract(d+z0); col+=P[2]*exp(-min(f,1.-f)*30.)*.5*bright;
  } else if(m==4){ // light-speed warp
    float d=.35/r; float n=140.; float idx=floor((a/TAU+.5)*n); float h=h1(idx);
    float seg=fract(d*.35+z0*(.6+h*1.4)+h*10.);
    float streak=smoothstep(0.,.04,seg)*smoothstep(.45,.08,seg)*step(.35,h);
    float ang=fract((a/TAU+.5)*n);
    col=pal(P,h+tb*.02)*streak*exp(-abs(ang-.5)*7.)*1.6*bright;
    float f=fract(d+z0); col+=P[1]*exp(-min(f,1.-f)*40.)*.25*pu;
  } else if(m==5){ // hex tunnel
    float sec=TAU/6.; float ar=mod(a,sec)-sec*.5; float rp=L*cos(ar);
    float z=.3/rp+z0; ar=mod(a+floor(z)*.26,sec)-sec*.5; rp=L*cos(ar); r=rp;
    z=.3/rp+z0; float f=fract(z), e=min(f,1.-f);
    col=pal(P,floor(z)*.2)*exp(-e*16.)*bright;
    col+=pal(P,floor(z)*.2+.33)*exp(-abs(abs(ar)-sec*.5)*40.)*.5;
  } else if(m==6){ // lasers
    vec2 p=uv-vec2(0.,-.62); float an=atan(p.x,p.y); float d=length(p);
    for(int i=0;i<9;i++){float fi=float(i);
      float ba=sin(spd*PI*.25+fi*.9)*.85+(fi-4.)*.05;
      col+=pal(P,fi/9.+tb*.02)*exp(-abs(an-ba)*(70.+30.*sin(fi)))*exp(-d*.6)*1.2*bright;}
    col+=P[2]*.06*exp(-d*1.5)*(1.+pu*2.); col+=P[0]*exp(-d*14.)*.8;
  } else if(m==7){ // retro grid + sun
    float hz=.08;
    if(uv.y<hz){
      float dy=hz-uv.y; float d=.25/dy; float x=uv.x*d*1.5; float z=d+z0*2.;
      float lx=min(fract(x),1.-fract(x)), lz=min(fract(z),1.-fract(z));
      col=pal(P,.05)*(exp(-lx*12.)+exp(-lz*12.))*smoothstep(0.,.25,dy)*bright+P[2]*.25*exp(-dy*8.);
    } else {
      vec2 c=vec2(0.,.33); float R=.26; float s=length(uv-c);
      float cut=uv.y>c.y?1.:step(.35,fract((uv.y-c.y)*18.-spd*.5));
      vec3 sunc=mix(P[1],P[0],clamp((uv.y-c.y+R)/(2.*R),0.,1.));
      col=sunc*smoothstep(R,R-.01,s)*cut*(1.+pu*.5)+P[0]*.25*exp(-max(s-R,0.)*6.)+P[2]*.12*exp(-(uv.y-hz)*4.);
      col+=vec3(.8)*step(.997,hv(floor(uv*150.)))*smoothstep(.25,.6,uv.y);
    }
  } else if(m==8){ // plasma
    float t=spd*.5;
    float v=sin(uv.x*3.+t)+sin(uv.y*4.-t*1.3)+sin((uv.x+uv.y)*3.+t*.7)+sin(length(uv*4.+vec2(sin(t*.3),cos(t*.4))*2.)-t);
    col=pal(P,v*.12+t*.03)*(.55+.25*sin(v*2.))*bright;
  } else if(m==9){ // bokeh
    col=P[2]*.04;
    for(int i=0;i<26;i++){float fi=float(i); float ha=h1(fi*3.1), hb=h1(fi*7.7), hc=h1(fi*1.3);
      vec2 c=vec2((ha*2.-1.)*.95+sin(tb*.1+fi)*.05, fract(hb+spd*.02*(.5+hc))*1.4-.7);
      float s=(.04+.1*hc)*(1.+pu*.3); float d=length(uv-c);
      float disk=smoothstep(s,s*.8,d); float rim=smoothstep(s,s*.93,d)-smoothstep(s*.93,s*.86,d);
      col+=pal(P,ha)*(disk*.22+rim*.25)*(.7+.3*hb);}
  } else if(m==10){ // aurora
    float t=spd*.25; col=mix(P[2]*.02,P[2]*.1,uv.y+.5);
    for(int i=0;i<3;i++){float fi=float(i);
      float y=(fbm(vec2(uv.x*1.2+t*.5+fi*3.,t*.3+fi))-.5)*.7+.05+fi*.08;
      float band=exp(-abs(uv.y-y)*7.)*smoothstep(-.3,.1,uv.y-y+.05);
      float streak=.5+.5*vnoise(vec2(uv.x*25.+fi*9.,t*2.));
      col+=pal(P,fi*.3+uv.x*.15+t*.05)*band*streak*.55*bright;}
    col+=vec3(.6)*step(.996,hv(floor(uv*130.)));
  } else if(m==11){ // bouncing EQ bars
    float nb=16.; float xx=(uv.x+.85)/1.7*nb; float idx=floor(xx); float fx=fract(xx);
    if(idx>=0.&&idx<nb){
      float bn=floor(spd*2.); float env=exp(-fract(spd*2.)*3.);
      float hgt=.1+.75*(.3+.7*h1(idx*13.+bn))*(.35+.65*env);
      float yy=uv.y+.45; float inBar=step(.12,fx)*step(fx,.88); float seg=step(.25,fract(yy*28.));
      if(yy>0.&&yy<hgt) col=pal(P,yy*.9+idx*.02)*inBar*seg*(1.+pu*.6);
      if(yy<0.&&-yy<hgt*.4) col=pal(P,-yy)*inBar*seg*.18*(1.+yy/(hgt*.4));
      if(abs(yy-hgt-.03)<.008) col+=P[1]*inBar;
    }
  } else if(m==12){ // bouncing dot grid
    float g=.1; vec2 cell=floor(uv/g); vec2 f=fract(uv/g)-.5; vec2 cc=(cell+.5)*g;
    float ph=fract(spd-length(cc)*.9); float rr=.08+.3*exp(-ph*5.);
    col=pal(P,length(cc)*.6-tb*.1)*smoothstep(rr,rr-.06,length(f))*(.8+pu);
  } else if(m==13){ // kaleidoscope
    float sec=TAU/8.; float ka=mod(a+spd*.1,sec); ka=abs(ka-sec*.5);
    vec2 p=vec2(cos(ka),sin(ka))*L*(1.+.15*pu); vec2 q=p*4.-vec2(z0*.8,0.);
    float v=sin(q.x*2.+sin(q.y*3.+tb*.5))+cos(L*10.-z0*3.)+sin(q.y*5.-tb*.3);
    col=pal(P,v*.15+L*.3-tb*.04)*smoothstep(0.,1.5,v+.5)*bright*(smoothstep(1.1,.2,L)+.2);
  } else if(m==14){ // firelight
    float t=spd*.4; vec2 q=vec2(uv.x*2.2,uv.y*1.8+.9);
    float n=fbm(q-vec2(0.,t*1.2)+fbm(q*1.3+vec2(t*.2,-t))*.8);
    float heat=clamp(n*1.6-q.y*.45,0.,1.);
    col=P[1]*smoothstep(.15,.5,heat); col=mix(col,P[0],smoothstep(.45,.75,heat)); col=mix(col,P[2],smoothstep(.75,1.,heat));
    col*=heat*1.4*(1.+pu*.5);
  } else if(m==15){ // water ripples
    float t=spd; col=mix(P[0]*.05,P[0]*.15,.5+.5*uv.y)+P[1]*.05*fbm(uv*3.+t*.05);
    for(int i=0;i<6;i++){float fi=float(i); float cyc=t*.5+fi/6.; float id=floor(cyc); float age=fract(cyc);
      vec2 c=vec2(h1(id*3.3+fi)*1.6-.8,h1(id*5.1+fi*2.)*.8-.4); float d=length((uv-c)*vec2(1.,1.6));
      float ring=exp(-abs(d-age*.7)*60.)+exp(-abs(d-age*.5)*80.)*.5;
      col+=pal(P,h1(id+fi))*ring*(1.-age)*.8*bright;}
  } else if(m==16){ // sun rays
    float t=spd*.2; vec2 p=uv-vec2(-.3,.75); float an=atan(p.x,-p.y); float d=length(p);
    float rays=pow(vnoise(vec2(an*9.,t))*.6+vnoise(vec2(an*23.,t*1.7))*.4,2.2);
    col=mix(P[2]*.03,P[1]*.12,clamp(1.-d*.6,0.,1.));
    col+=pal(P,.1+rays*.3)*rays*exp(-d*.9)*1.3*bright+P[1]*exp(-d*5.)*.5;
    vec2 g=uv*18.+vec2(t*2.,-t*3.);
    col+=P[1]*step(.985,hv(floor(g)))*smoothstep(.3,0.,length(fract(g)-.5))*rays*1.5;
  } else if(m==17){ // fireflies
    float t=spd*.3; col=mix(P[0]*.03,P[0]*.1,.5-uv.y);
    for(int i=0;i<36;i++){float fi=float(i); float ha=h1(fi*1.7), hb=h1(fi*9.3);
      vec2 c=vec2(sin(t*(.3+ha*.4)+ha*20.)*.85,cos(t*(.25+hb*.3)+hb*20.)*.42);
      float tw=.4+.6*pow(.5+.5*sin(t*6.*(.5+ha)+ha*30.),3.); float d=length(uv-c);
      col+=mix(P[1],P[2],ha)*(.0008/(d*d+.0008))*tw*.35*(1.+pu);}
  } else if(m==18){ // stripes
    vec2 p=rot(PI*.25+sin(spd*PI*.125)*.3)*uv; float s=p.x*5.-z0*2.;
    float band=smoothstep(.45,.5,fract(s))-smoothstep(.95,1.,fract(s));
    col=pal(P,floor(s)*.23)*band*bright*(.6+.4*(1.-fract(tb)));
  } else if(m==20){ // soft clouds
    float t=spd*.15; vec2 q=uv*1.6+vec2(t,0.);
    float n=fbm(q+fbm(q*.7+t*.3));
    vec3 sky=mix(P[2]*.25,P[0]*.35,uv.y+.5);
    col=mix(sky,pal(P,.3+n*.3),smoothstep(.45,.8,n))*(.8+pu*.4);
    col+=P[1]*exp(-length(uv-vec2(.35,.3))*3.)*.3;
  } else if(m==21){ // moonlit sea
    float t=spd*.3; col=mix(P[0]*.08,P[0]*.3,clamp(uv.y*1.5+.3,0.,1.));
    vec2 mc=vec2(.25,.28); float md=length(uv-mc);
    col+=P[2]*smoothstep(.09,.085,md)*.9+P[2]*exp(-md*5.)*.25*(1.+pu*.4);
    col+=vec3(.7)*step(.996,hv(floor(uv*130.)))*step(0.,uv.y);
    for(int i=0;i<5;i++){float fi=float(i);
      float y=-.02-fi*.1+.025*sin(uv.x*(4.+fi*1.5)+t*(1.+fi*.3)+fi*2.)+.015*sin(uv.x*11.-t*1.7+fi);
      if(uv.y<y){ col=mix(P[0]*(.12+fi*.05),P[1]*(.3-fi*.04),.5)*(1.+pu*.2);
        col+=P[2]*exp(-abs(uv.x-mc.x)*6.)*.2*(.5+.5*sin(uv.y*140.+t*3.+fi)); }
    }
  } else if(m==22){ // slow spotlights in haze
    float t=spd*.25; col=P[0]*.03;
    float haze=.6+.4*fbm(uv*2.5+vec2(t*.3,-t*.2));
    for(int i=0;i<5;i++){float fi=float(i);
      vec2 p=uv-vec2((fi-2.)*.35,.62); float an=atan(p.x,-p.y)-sin(t+fi*1.7)*.45;
      col+=pal(P,fi*.2)*exp(-abs(an)*12.)*smoothstep(1.4,0.,length(p))*haze*.55*(1.+pu*.5);
      col+=pal(P,fi*.2)*exp(-length(p)*18.)*.6;}
  } else if(m==26){ // lava lamp
    float t=spd*.2; float f=0.;
    for(int i=0;i<7;i++){float fi=float(i);
      vec2 c=vec2(sin(t*(.5+h1(fi)*.5)+fi*2.)*.55,sin(t*(.3+h1(fi+9.)*.4)+fi)*.35);
      float rr=.1+.06*h1(fi+3.); f+=rr*rr/dot(uv-c,uv-c);}
    float mm=smoothstep(.9,1.1,f);
    col=mix(P[2]*.08,pal(P,f*.1+t*.05),mm)*(.8+pu*.3)+pal(P,.5)*smoothstep(.4,1.,f)*.15*(1.-mm);
  } else if(m==27){ // floating lanterns
    float t=spd; col=mix(vec3(.01,.01,.03),P[1]*.1,clamp(.4-uv.y,0.,1.));
    for(int i=0;i<22;i++){float fi=float(i); float ha=h1(fi*2.3), hb=h1(fi*5.9), hc=h1(fi*8.1);
      float s=.02+.035*hc; vec2 c=vec2((ha*2.-1.)*.9+sin(t*.15+fi)*.04,fract(hb+t*.012*(.5+hc))*1.6-.8);
      vec2 p=(uv-c)/s; float flick=.8+.2*sin(t*5.+fi*3.);
      col+=mix(P[0],P[2],p.y*.3+.5)*smoothstep(1.,.85,length(p*vec2(1.,.8)))*.8*flick*(.4+.6*hc);
      col+=P[0]*exp(-length(uv-c)/s*.8)*.08*flick;}
  } else if(m==28){ // contour waves
    float t=spd*.15; float n=fbm(uv*1.5+vec2(t,t*.6))+.3*fbm(uv*3.-t);
    float v=n*14.; float line=exp(-min(fract(v),1.-fract(v))*20.);
    col=pal(P,n*.8+t*.1)*(line*.7+.08)*(1.+pu*.4);
  } else if(m==29){ // galaxy
    float t=spd*.05; vec2 p=rot(t)*uv; float r2=length(p); float an=atan(p.y,p.x);
    float arms=pow(.5+.5*cos(2.*an-log(r2+.01)*4.),3.);
    col=pal(P,r2*1.2+.2)*arms*exp(-r2*2.5)*(.6+.8*fbm(p*6.))*1.2+P[2]*exp(-r2*12.)*.8*(1.+pu*.3);
    col+=vec3(.8)*step(.993,hv(floor(uv*120.)));
  } else if(m==30){ // sunset hills
    float t=spd*.05;
    col=mix(P[0],P[2]*.4,clamp(uv.y*1.2+.2,0.,1.))*.6;
    vec2 sc=vec2(0.,-.05+.08*sin(t)); float sd=length(uv-sc);
    col+=P[1]*smoothstep(.17,.16,sd)+P[1]*exp(-sd*3.)*.35*(1.+pu*.3);
    for(int i=0;i<3;i++){float fi=float(i);
      float y=-.12-fi*.1+.06*sin(uv.x*(2.+fi)+fi*2.+t*(.5+fi*.3))+.03*sin(uv.x*7.+fi);
      if(uv.y<y) col=P[2]*(.18-fi*.05);}
  } else if(m==23){ // night sky
    float t=spd; col=mix(P[0]*.02,P[0]*.16,.5-uv.y*.8)+P[1]*.07*fbm(uv*2.+vec2(t*.01,0.));
    vec2 g=uv*60.; float hh=hv(floor(g)); float d=length(fract(g)-.5);
    col+=vec3(1.)*step(.975,hh)*smoothstep(.12,0.,d)*(.5+.5*sin(t*1.5+hh*60.));
    vec2 mc=vec2(-.45,.25); float md=length(uv-mc);
    col+=P[2]*smoothstep(.11,.105,md)*(1.-.35*fbm((uv-mc)*12.))+P[2]*exp(-md*4.)*.3*(1.+pu*.5);
    float cyc=t/8.; float id2=floor(cyc); float age=fract(cyc)*4.;
    if(age<1.){ vec2 s0=vec2(h1(id2)*1.2-.2,.45); vec2 dir=normalize(vec2(-1.,-.45));
      vec2 rel=uv-(s0+dir*age); float along=dot(rel,-dir); float perp=abs(dot(rel,vec2(-dir.y,dir.x)));
      col+=vec3(1.)*step(0.,along)*exp(-along*6.)*exp(-perp*400.)*(1.-age); }
  } else if(m==24){ // snowfall
    float t=spd; col=mix(P[0]*.05,P[0]*.18,.5-uv.y)+P[2]*exp(-length(uv-vec2(0.,.6))*2.)*.12;
    for(int i=0;i<4;i++){float fi=float(i); float sc=14.-fi*3.;
      vec2 g=uv*sc+vec2(sin(t*.2+fi)*.5,t*(.3+fi*.08)); vec2 id=floor(g); vec2 f=fract(g)-.5;
      float hh=hv(id+fi*7.); vec2 o=(vec2(hv(id+1.3),hv(id+2.7))-.5)*.6;
      col+=mix(P[1],vec3(1.),.6)*step(.5,hh)*smoothstep(.1+fi*.03,0.,length(f-o))*(.3+fi*.18)*(1.+pu*.3);}
  } else if(m==25){ // silk ribbons
    float t=spd*.3; col=P[0]*.03;
    for(int i=0;i<5;i++){float fi=float(i);
      float y=sin(uv.x*(1.5+fi*.3)+t*(1.+fi*.2)+fi*1.3)*.25*cos(t*.3+fi)+(fi-2.)*.06;
      float d=abs(uv.y-y);
      col+=pal(P,fi*.2+uv.x*.1+t*.03)*(exp(-d*40.)*.6+exp(-d*8.)*.12)*(1.+pu*.4);}
  } else if(m==31){ // infinite box zoom
    vec2 q=abs(uv); float rr=max(q.x,q.y); float z=-log2(rr)*1.5+z0; float k=floor(z);
    q=abs(rot(k*.25+tb*.1)*uv); rr=max(q.x,q.y); z=-log2(rr)*1.5+z0; float f=fract(z);
    col=pal(P,floor(z)*.15)*exp(-min(f,1.-f)*14.)*bright*smoothstep(0.,.08,rr);
  } else if(m==32||m==33){ // triangle / octagon tunnel
    float N=m==32?3.:8.; float sec=TAU/N; float ar=mod(a+z0*.1,sec)-sec*.5; float rp=L*cos(ar);
    float z=.3/rp+z0; float f=fract(z);
    col=pal(P,floor(z)*.21)*exp(-min(f,1.-f)*16.)*bright+pal(P,floor(z)*.21+.4)*exp(-abs(abs(ar)-sec*.5)*30.)*.4;
    col*=clamp(rp*2.4,0.,1.);
  } else if(m==34){ // shockwaves on the beat
    float ph=fract(spd);
    for(int i=0;i<4;i++){float fi=float(i); float age=ph+fi;
      col+=pal(P,(floor(spd)-fi)*.2)*exp(-abs(L-age*.6)*30.)*exp(-age*1.1)*bright;}
    col+=P[2]*exp(-L*14.)*(.4+pu);
  } else if(m==35){ // waveform
    float t=spd; float env=exp(-fract(t)*3.);
    col+=P[2]*.05*step(.47,max(abs(fract(uv.x*5.)-.5),abs(fract(uv.y*5.)-.5)));
    for(int i=0;i<4;i++){float fi=float(i);
      float y=sin(uv.x*(6.+fi*3.)+t*PI*(1.+fi*.5))*(.08+.22*env)*cos(uv.x*1.5)*(1.-fi*.2);
      float d=abs(uv.y-y); col+=pal(P,fi*.25+uv.x*.2)*(exp(-d*80.)+exp(-d*12.)*.2)*bright;}
  } else if(m==36){ // tile flip
    float g=.14; vec2 id=floor(uv/g); vec2 f=fract(uv/g)-.5; float hh=hv(id);
    float bt=floor(spd); float on=step(.55,hv(id+bt*1.37)); float env=exp(-fract(spd)*3.);
    col=pal(P,hh+bt*.1)*smoothstep(.45,.4,max(abs(f.x),abs(f.y)))*(on*(.3+.9*env)+.06)*(1.+pu*.3);
  } else if(m==37){ // sunburst
    float ra=fract((a+spd*.15)/TAU*16.); float ray=smoothstep(.45,.5,ra)-smoothstep(.95,1.,ra);
    col=mix(pal(P,.1)*.25,pal(P,.5),ray)*bright*(1.-smoothstep(0.,1.2,L)*.6)+P[2]*exp(-L*6.)*(.6+pu);
  } else if(m==38){ // wormhole
    float d=.3/r; float v=d+z0; float aa=a+d*.4;
    float n=fbm(vec2(cos(aa),sin(aa))*1.8+vec2(v*1.2,v*.7));
    float n2=fbm(vec2(cos(aa),sin(aa))*3.5+vec2(v*2.,3.));
    col=(pal(P,n+v*.05)*pow(n,1.5)*1.8*bright+P[1]*pow(n2,6.)*3.)*clamp(r*2.2,0.,1.);
  } else if(m==39){ // digital rain
    float cols=40.; float gx=(uv.x+1.)*cols*.5; float cx=floor(gx); float hh=h1(cx);
    float y=uv.y*cols*.5; float cy=floor(y);
    float hp=1.-fract(spd*(.5+hh)*.15+hh)*2.4; float dist=uv.y-hp;
    float box=step(.15,fract(gx))*step(fract(gx),.85)*step(.15,fract(y))*step(fract(y),.85);
    float ch=step(.3,hv(vec2(cx,cy+floor(tb*4.))));
    col=pal(P,hh*.3)*step(0.,dist)*exp(-dist*4.)*box*ch*1.2+vec3(.8)*box*exp(-abs(dist)*60.);
  } else if(m==40){ // hyper grid floor + ceiling
    float ay=abs(uv.y)+.001; float d=.25/ay; float x=uv.x*d*1.5; float z=d+z0*2.;
    float lx=min(fract(x),1.-fract(x)), lz=min(fract(z),1.-fract(z));
    col=pal(P,floor(z)*.1+(uv.y>0.?.5:0.))*(exp(-lx*12.)+exp(-lz*12.))*smoothstep(0.,.3,ay)*bright+P[2]*exp(-ay*20.)*.5;
  } else if(m==41){ // bouncing orbs
    col+=P[2]*exp(-abs(uv.y+.42)*80.)*.4;
    for(int i=0;i<7;i++){float fi=float(i);
      float hgt=abs(sin(PI*(spd-fi*.125)))*.55; vec2 c=vec2((fi-3.)*.25,-.35+hgt);
      float d=length(uv-c); col+=pal(P,fi/7.)*(smoothstep(.07,.06,d)+.004/(d*d+.004)*.3)*bright;}
  } else if(m==42){ // circle EQ
    float n=48.; float t2=(a/TAU+.5)*n; float idx=floor(t2); float fa=fract(t2);
    float bt=floor(spd*2.); float env=exp(-fract(spd*2.)*3.);
    float hgt=.08+.3*(.3+.7*h1(idx*7.+bt))*(.35+.65*env); float r0=.18;
    col=pal(P,idx/n+tb*.02)*step(r0,L)*step(L,r0+hgt)*step(.2,fa)*step(fa,.8)*bright;
    col+=P[2]*smoothstep(r0,r0-.01,L)*(.15+pu*.5)+pal(P,.5)*exp(-abs(L-r0)*60.)*.6;
  } else if(m==43){ // falling leaves
    float t=spd; col=mix(P[1]*.06,P[0]*.14,uv.y+.5);
    for(int i=0;i<20;i++){float fi=float(i); float ha=h1(fi*2.1), hb=h1(fi*4.7), hc=h1(fi*6.3);
      float s=.02+.03*hc; vec2 c=vec2((ha*2.-1.)*.95+sin(t*.4+fi*2.)*.08,.8-fract(hb+t*.03*(.6+hc))*1.7);
      vec2 p=rot(t*(.5+ha)+fi)*(uv-c)/s; p.x*=1.+.5*sin(t*1.3+fi);
      col+=pal(P,ha)*smoothstep(1.,.9,length(vec2(p.x*.55,p.y)))*(.5+.5*hc);}
  } else if(m==44){ // gentle rain
    float t=spd; col=mix(P[0]*.04,P[0]*.12,uv.y+.5)+P[2]*exp(-length(uv-vec2(.4,.2))*3.)*.2*(1.+pu*.3);
    for(int i=0;i<3;i++){float fi=float(i); float sc=30.+fi*20.;
      vec2 g=vec2(uv.x*sc,uv.y*sc*.15+t*(1.5+fi*.5)); vec2 id=floor(g); vec2 f=fract(g);
      float drop=step(.85,hv(id+fi*9.))*smoothstep(0.,.1,f.y)*smoothstep(.6,.1,f.y)*exp(-abs(f.x-.5)*20.);
      col+=mix(P[1],vec3(1.),.5)*drop*(.25+fi*.1);}
  } else if(m==45){ // candles
    float t=spd; col=mix(vec3(.01),P[1]*.05,.5-uv.y);
    for(int i=0;i<7;i++){float fi=float(i);
      float x=(fi-3.)*.24+(h1(fi)-.5)*.05; float base=-.2-h1(fi+2.)*.15; float hgt=.18+.12*h1(fi+4.);
      vec2 p=uv-vec2(x,base-hgt*.5);
      col=mix(col,P[2]*.35*(1.-abs(p.x)*10.),step(abs(p.x),.035)*step(abs(p.y),hgt*.5));
      vec2 fp=uv-vec2(x+sin(t*3.+fi)*.004,base+.035); fp.x*=2.2+.3*sin(t*7.+fi*3.);
      float fl=length(vec2(fp.x,fp.y*(fp.y>0.?.7:1.4)));
      vec2 gp=uv-vec2(x,base+.04);
      col+=mix(P[0],P[2],.5)*smoothstep(.035,0.,fl)*1.2+P[0]*.01/(dot(gp,gp)+.01)*.08*(1.+pu*.3);}
  } else if(m==46){ // sunlit water
    float t=spd*.3; vec2 p=uv*5.; float c=0.;
    for(int i=0;i<3;i++){float fi=float(i);
      p+=vec2(sin(p.y+t*(1.+fi*.3)),cos(p.x-t*(.8+fi*.2)))*.6;
      c+=1./(1.+abs(sin(p.x)+sin(p.y))*4.);}
    col=P[0]*.25+pal(P,.3+c*.1)*pow(c*.4,3.)*1.5*(1.+pu*.3);
  } else if(m==47){ // stained glass
    vec2 g=uv*5.; vec2 id=floor(g); vec2 f=fract(g); float d1=9., d2=9.; vec2 best=vec2(0.);
    for(int j=-1;j<=1;j++){ for(int i=-1;i<=1;i++){ vec2 o=vec2(float(i),float(j));
      vec2 pt=.5+.4*sin(spd*.3+vec2(hv(id+o),hv(id+o+5.3))*6.28); float d=length(o+pt-f);
      if(d<d1){d2=d1;d1=d;best=id+o;} else if(d<d2){d2=d;} } }
    float edge=d2-d1; float hh=hv(best);
    col=pal(P,hh)*(.35+.4*(.5+.5*sin(spd*.5+hh*20.)))*smoothstep(.02,.06,edge)*bright+P[2]*exp(-edge*40.)*.2;
  } else if(m==48){ // lightning storm
    float t=spd; float bi=floor(t); float ph=fract(t);
    col=P[2]*.08*fbm(uv*2.+vec2(t*.05,0.))+P[0]*.02;
    if(h1(bi)>.35){
      float fade=exp(-ph*5.); float x0=(h1(bi+1.)-.5)*1.2;
      float path=x0+(fbm(vec2(uv.y*5.,bi))-.5)*.5+(vnoise(vec2(uv.y*30.,bi*3.))-.5)*.05;
      float d=abs(uv.x-path); float mask=step(-.5+h1(bi+2.)*.3,uv.y);
      col+=mix(P[0],vec3(1.),.6)*(exp(-d*300.)*1.5+exp(-d*25.)*.3)*fade*mask;
      col+=P[0]*.18*fade*(1.+pu);
    }
  } else if(m==49){ // rising sparks
    float t=spd; col=P[2]*.03*(.5-uv.y)+P[0]*exp(-(uv.y+.55)*6.)*.35;
    for(int i=0;i<40;i++){float fi=float(i); float ha=h1(fi*1.9), hb=h1(fi*3.7), hc=h1(fi*6.1);
      float life=fract(hb+t*.25*(.5+hc));
      vec2 c=vec2((ha-.5)*1.6+sin(fi+life*4.)*.06,-.6+life*1.3);
      vec2 dd=(uv-c)*vec2(1.,.5); float d2=dot(dd,dd);
      col+=mix(P[0],P[1],hc)*.00004/(d2+.00004)*(1.-life)*1.6*(1.+pu);}
  } else if(m==50){ // city at night
    float t=spd; col=mix(P[2]*.3,P[0]*.04,clamp(uv.y+.2,0.,1.));
    col+=vec3(.6)*step(.996,hv(floor(uv*140.)))*step(.15,uv.y);
    for(int i=0;i<2;i++){float fi=float(i); float w=.09-fi*.03;
      float xx=(uv.x+t*.01*(fi+1.))/w; float bx=floor(xx);
      float bh=.1+h1(bx*1.7+fi*50.)*.35-fi*.2;
      if(uv.y<bh){ col=mix(P[2]*.06,vec3(.01),fi);
        float rows=30.+fi*10.; float lx=fract(xx*3.), ly=fract(uv.y*rows);
        float lit=step(.55,hv(vec2(floor(xx*3.),floor(uv.y*rows))+fi*9.+floor(t*.125)));
        col+=mix(P[1],P[0],hv(vec2(bx,fi)))*lit*step(.25,lx)*step(lx,.75)*step(.3,ly)*step(ly,.7)*(.4+fi*.4)*(1.+pu*.6);
        col*=step(.04,fract(xx))*step(fract(xx),.96)*.9+.1;
      }}
    col+=P[0]*exp(-abs(uv.y-.05)*8.)*.08;
  } else if(m==51){ // confetti
    float t=spd; col=P[2]*.04+P[0]*.03;
    for(int i=0;i<50;i++){float fi=float(i); float ha=h1(fi*2.7), hb=h1(fi*4.3), hc=h1(fi*7.9);
      float fall=fract(hb+t*.06*(.6+hc));
      vec2 c=vec2((ha*2.-1.)*.95+sin(t*.8+fi)*.05,.75-fall*1.5);
      vec2 p=rot(t*(1.+ha*3.)+fi)*(uv-c); p.x/=abs(sin(t*2.+fi*1.3))*.8+.2;
      col+=pal(P,ha)*step(abs(p.x),.016)*step(abs(p.y),.009)*1.2*(1.+pu*.4);}
  } else if(m==52){ // balloons
    float t=spd; col=mix(P[2]*.15,P[2]*.05,uv.y+.5);
    for(int i=0;i<14;i++){float fi=float(i); float ha=h1(fi*2.2), hb=h1(fi*4.4), hc=h1(fi*6.6);
      float s=.05+.04*hc; vec2 c=vec2((ha*2.-1.)*.85+sin(t*.3+fi)*.04,-.8+fract(hb+t*.02*(.6+hc))*1.8);
      vec2 q=(uv-c)/s; float body=smoothstep(1.,.95,length(vec2(q.x,q.y*.85)));
      float shine=smoothstep(.35,.1,length(q-vec2(-.35,.35)));
      col=mix(col,pal(P,ha)*(1.1+.2*q.y)+shine*.6,body);
      float sxp=c.x+sin((uv.y-c.y)*20.+t)*.004;
      col+=vec3(.4)*step(uv.y,c.y-s*1.15)*step(c.y-s*1.15-.25,uv.y)*exp(-abs(uv.x-sxp)*800.)*(1.-body);}
  } else if(m==53){ // bubbles
    float t=spd; col=mix(P[0]*.05,P[2]*.12,uv.y+.5);
    for(int i=0;i<24;i++){float fi=float(i); float ha=h1(fi*3.3), hb=h1(fi*5.1), hc=h1(fi*8.7);
      float s=.02+.06*hc; vec2 c=vec2((ha*2.-1.)*.9+sin(t*.6+fi*2.)*.05,-.8+fract(hb+t*.03*(.5+hc))*1.7);
      vec2 q=(uv-c)/s; float d=length(q);
      col+=pal(P,ha+d*.2+t*.05)*smoothstep(.75,1.,d)*smoothstep(1.05,.98,d)*.9*(1.+pu*.3);
      col+=vec3(.8)*smoothstep(.3,0.,length(q-vec2(-.4,.4)))*.6;}
  } else if(m==54){ // fireworks
    float t=spd; col=mix(vec3(.005,.005,.02),P[2]*.06,clamp(.2-uv.y,0.,1.));
    for(int i=0;i<4;i++){float fi=float(i); float cyc=t*.25+fi*.25; float id=floor(cyc); float age=fract(cyc);
      vec2 c=vec2(h1(id*3.+fi)*1.2-.6,h1(id*7.+fi)*.35+.05); vec3 fc=pal(P,h1(id+fi*5.));
      if(age<.15){ vec2 rp=vec2(c.x,-.6+(c.y+.6)*age/.15); vec2 dd=uv-rp; col+=fc*.0015/(dot(dd,dd)+.0015)*.5; }
      else { float e=(age-.15)/.85; float R=.35*(1.-pow(1.-e,3.)); vec2 d=uv-c; d.y+=e*e*.12;
        float dl=length(d); float an=atan(d.y,d.x); float ray=pow(.5+.5*cos(an*28.+id),20.);
        col+=fc*(exp(-abs(dl-R)*70.)*(.3+ray*1.4)+exp(-dl*8.)*.12)*(1.-e)*1.4*(1.+pu*.3); }
    }
  } else if(m==55){ // fairy lights
    float t=spd; col=P[2]*.02+P[0]*.02*(.5-uv.y);
    for(int i=0;i<4;i++){float fi=float(i); float y0=.35-fi*.23;
      float sx=fract(uv.x*1.2+fi*.3)*2.-1.; float y=y0-.08*(1.-sx*sx);
      col+=vec3(.25)*exp(-abs(uv.y-y)*400.);
      float cell=floor((uv.x+1.)*12.); float bx=(cell+.5)/12.-1.;
      float bsx=fract(bx*1.2+fi*.3)*2.-1.; vec2 bp=vec2(bx,y0-.08*(1.-bsx*bsx)-.015);
      float hh=h1(cell+fi*31.); vec2 dd=uv-bp;
      col+=pal(P,hh)*(smoothstep(.012,.006,length(dd))*1.2+.00015/(dot(dd,dd)+.00015)*.5)*(.4+.6*(.5+.5*sin(t*2.+hh*30.)))*(1.+pu*.5);}
  } else if(m==56){ // nebula
    float t=spd*.05; vec2 q=uv*1.5; float n=fbm(q+fbm(q*1.7+t)*1.2+vec2(t,0.)); float n2=fbm(q*2.5-t*.5);
    col=pal(P,n*1.2+n2*.3)*pow(n,2.)*1.6*(1.+pu*.3)+P[2]*pow(n2,4.)*.8;
    float st=hv(floor(uv*160.)); col+=vec3(1.)*step(.994,st)*(.5+.5*sin(tb*2.+st*50.));
  } else if(m==57){ // glowing cross
    float t=spd; col=mix(P[2]*.05,P[1]*.08,.5+uv.y*.5);
    vec2 p=uv-vec2(0.,.02);
    float d=min(max(abs(p.x)-.025,abs(p.y+.02)-.3),max(abs(p.x)-.17,abs(p.y-.1)-.025));
    float an=atan(p.x,p.y); col+=P[1]*pow(vnoise(vec2(an*8.,t*.2)),3.)*exp(-length(p)*2.)*.35;
    col+=P[0]*exp(-max(d,0.)*14.)*(.6+.2*sin(t*.5))*(1.+pu*.4)*.6+mix(P[0],vec3(1.),.6)*smoothstep(.004,0.,d);
  } else if(m==58){ // heaven light
    float t=spd*.1; vec2 q=uv*1.4+vec2(t,0.); float n=fbm(q+fbm(q*.6+t));
    col=mix(P[2]*.35,P[0]*.9,smoothstep(.35,.8,n));
    vec2 p=uv-vec2(0.,.55); float an=atan(p.x,-p.y);
    col+=P[1]*pow(vnoise(vec2(an*10.,t*2.)),2.)*exp(-length(p)*1.2)*.9*(1.+pu*.3)+P[1]*exp(-length(p)*3.)*.5;
  } else if(m==59){ // neon shapes
    float t=spd; col=P[2]*.02;
    for(int i=0;i<12;i++){float fi=float(i); float ha=h1(fi*2.9), hb=h1(fi*6.7), hc=h1(fi*9.1);
      vec2 c=vec2((ha*2.-1.)*.8+sin(t*.1+fi)*.1,(hb*2.-1.)*.4+cos(t*.13+fi)*.08);
      float s=(.05+.06*hc)*(1.+pu*.2);
      vec2 p=rot(t*.6*(ha-.5)+fi)*(uv-c)/s; float d;
      if(hc<.5){ float k=1.7320508; p.x=abs(p.x)-1.; p.y=p.y+1./k;
        if(p.x+k*p.y>0.) p=vec2(p.x-k*p.y,-k*p.x-p.y)/2.; p.x-=clamp(p.x,-2.,0.); d=-length(p)*sign(p.y); }
      else d=length(p)-1.;
      float ds=abs(d)*s; col+=pal(P,ha+t*.02)*(exp(-ds*300.)*1.2+exp(-ds*40.)*.15);}
  } else { // star drift
    float t=spd; col=P[2]*.02+P[1]*.12*fbm(uv*2.+t*.01);
    for(int i=0;i<4;i++){float fi=float(i); float dep=fract(fi*.25+t*.03);
      float sc=mix(28.,2.,dep); float fade=smoothstep(0.,.3,dep)*smoothstep(1.,.85,dep);
      vec2 g=uv*sc+fi*17.3; vec2 id=floor(g); vec2 f=fract(g)-.5; float hh=hv(id);
      vec2 o=vec2(hv(id+3.1),hv(id+7.7))-.5; float d=length(f-o*.7);
      col+=mix(pal(P,hh),vec3(1.),.5)*step(.55,hh)*(smoothstep(.08,0.,d)*1.2+.004/(d*d+.004)*.3)*fade*(1.+pu);}
  }

  if(m<=5){ col*=clamp(r*2.4,0.,1.); col+=mix(P[0],P[2],.5)*.35*exp(-L*10.)*(1.+pu); }
  col+=pal(P,tb*.05)*pu*.12;
  col*=1.-.35*smoothstep(.5,1.2,L);
  return col;
}

void main(){
  vec2 uv=(gl_FragCoord.xy-.5*uRes)/min(uRes.x,uRes.y);
  uv=rot(uRot)*uv; uv/=uZoom; uv+=uPan;
  if(uKal>1.5){ float sec=TAU/uKal; float a=mod(atan(uv.y,uv.x),sec); a=abs(a-sec*.5); uv=vec2(cos(a),sin(a))*length(uv); }
  if(uMirror>.5&&uMirror<1.5) uv.x=abs(uv.x);
  else if(uMirror>1.5&&uMirror<2.5) uv.y=abs(uv.y);
  else if(uMirror>2.5) uv=abs(uv);
  vec3 c0=vec3(0.), c1=vec3(0.);
  if(uMix<1.){ float pu=uPulse*uF0; c0=scene(uM0,uv/(1.+uK0*pu*.18),uB0,uS0,pu,uP0); }
  if(uMix>0.){ float pu=uPulse*uF1; c1=scene(uM1,uv/(1.+uK1*pu*.18),uB1,uS1,pu,uP1); }
  vec3 col=1.-exp(-mix(c0,c1,uMix)*1.5);
  if(uOv>0.){
    float pu=uPulse*uF2; vec3 c2=1.-exp(-scene(uM2,uv/(1.+uK2*pu*.18),uB2,uS2,pu,uP2)*1.5);
    vec3 o=c2*uOv;
    if(uOvMode<.5) col=min(col+o,1.);
    else if(uOvMode<1.5) col=1.-(1.-col)*(1.-o);
    else if(uOvMode<2.5) col=max(col,o);
    else col=mix(col,col*c2*1.6,uOv);
  }
  gl_FragColor=vec4(col,1.);
}`;
export const COMP_FS = `
precision highp float;
uniform sampler2D uScene; uniform sampler2D uPrev; uniform vec2 uRes;
uniform float uTrail; uniform float uEcho; uniform float uEchoRot; uniform float uRGB; uniform float uPix;
uniform float uHue; uniform float uSat; uniform float uCon; uniform float uGlow; uniform float uPost;
vec3 hueShift(vec3 c,float h){
  mat3 toY=mat3(.299,.596,.211,.587,-.274,-.523,.114,-.322,.312);
  mat3 toR=mat3(1.,1.,1.,.956,-.272,-1.106,.621,-.647,1.703);
  vec3 y=toY*c; float ch=cos(h),sh=sin(h); y.yz=mat2(ch,sh,-sh,ch)*y.yz; return toR*y; }
void main(){
  vec2 uv=gl_FragCoord.xy/uRes; vec2 suv=uv;
  if(uPix>.5){ vec2 px=vec2(uPix*uRes.y/360.)/uRes; suv=(floor(uv/px)+.5)*px; }
  vec3 col;
  if(uRGB>0.){ vec2 d=(suv-.5)*uRGB*.04; col=vec3(texture2D(uScene,suv+d).r,texture2D(uScene,suv).g,texture2D(uScene,suv-d).b); }
  else col=texture2D(uScene,suv).rgb;
  if(uGlow>0.){ vec3 g=vec3(0.); vec2 px=1./uRes;
    for(int i=0;i<8;i++){ float a=float(i)*.785398; vec2 o=vec2(cos(a),sin(a));
      g+=texture2D(uScene,suv+o*px*6.).rgb+texture2D(uScene,suv+o*px*14.).rgb; }
    g/=16.; col+=g*g*uGlow*1.5; }
  if(abs(uHue)>.001) col=hueShift(col,uHue);
  float l=dot(col,vec3(.299,.587,.114)); col=mix(vec3(l),col,uSat);
  col=(col-.5)*uCon+.5;
  if(uPost>1.5) col=floor(col*uPost+.5)/uPost;
  col=clamp(col,0.,1.);
  if(uTrail>0.){ float ar=uRes.x/uRes.y; vec2 f=uv-.5; f.x*=ar;
    float c=cos(uEchoRot), s=sin(uEchoRot); f=mat2(c,s,-s,c)*f; f*=1.-uEcho; f.x/=ar; f+=.5;
    vec3 p=texture2D(uPrev,f).rgb*uTrail-2./255.; col=max(col,p); }
  gl_FragColor=vec4(col,1.);
}`;
export const FINAL_FS = `
precision highp float;
uniform sampler2D uComp; uniform sampler2D uText; uniform vec2 uRes;
uniform float uBright; uniform float uWhite; uniform float uBlack; uniform float uInv; uniform float uScan; uniform float uVig;
uniform float uTextOn; uniform float uTextScale; uniform float uTextY; uniform vec3 uTextCol;
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec3 col=texture2D(uComp,uv).rgb*uBright;
  if(uTextOn>0.){
    vec2 p=(gl_FragCoord.xy-.5*uRes)/uRes.x; p.y-=uTextY*uRes.y/uRes.x;
    vec2 t=vec2(p.x/uTextScale+.5,p.y/(uTextScale*.25)+.5);
    if(t.x>0.&&t.x<1.&&t.y>0.&&t.y<1.){ float a=texture2D(uText,t).a*uTextOn;
      col=mix(col,uTextCol,a); col+=vec3(.35)*smoothstep(.85,1.,a); }
  }
  if(uScan>0.) col*=1.-uScan*.45*(.5+.5*sin(gl_FragCoord.y*1.5708));
  if(uVig>0.) col*=1.-uVig*smoothstep(.25,.85,length(uv-.5)*1.3);
  if(uInv>.5) col=1.-col;
  col=mix(col,vec3(1.),uWhite);
  col+=(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.; // dither: no banding in dark gradients
  col*=1.-uBlack;
  gl_FragColor=vec4(col,1.);
}`;
