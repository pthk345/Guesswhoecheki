const http=require('http'),fs=require('fs'),path=require('path'),{WebSocketServer}=require('ws');
const CARDS=require('./cards.json'),RU=require('./ru.json');
function cleanCustom(a){if(!Array.isArray(a))return null;const l=a.slice(0,60).map(c=>({n:String((c&&c.n)||'').trim().slice(0,40),u:/^https:\/\/\S{1,300}$/.test((c&&c.u)||'')?c.u:''})).filter(c=>c.n);return l.length>=8?l:null}
function makeDeck(cat,custom){const pool=custom?custom.map(c=>[c.n,'Своё поле',c.n,c.u]):cat&&CARDS[cat]?CARDS[cat].map((n,i)=>[n,cat,RU[cat][i]]):Object.entries(CARDS).flatMap(([c,l])=>l.map((n,i)=>[n,c,RU[c][i]]));for(let i=pool.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[pool[i],pool[j]]=[pool[j],pool[i]]}return pool.slice(0,24)}
const PORT=process.env.PORT||3000,TOKEN=process.env.BOT_TOKEN,URL_=process.env.WEBAPP_URL,BOT=process.env.BOT_USERNAME||'',APP=process.env.APP_SHORTNAME||'';
const html=()=>fs.readFileSync(path.join(__dirname,'public','index.html'),'utf8').replace('__CFG__',JSON.stringify({bot:BOT,app:APP,cats:Object.keys(CARDS)}));
const srv=http.createServer((req,res)=>{if(req.url==='/health'){res.end('ok');return}res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html())});
const wss=new WebSocketServer({server:srv}),rooms=new Map();
const send=(ws,o)=>ws&&ws.readyState===1&&ws.send(JSON.stringify(o));
const newCode=()=>{let c;do{c=Math.random().toString(36).slice(2,7).toUpperCase()}while(rooms.has(c));return c};
function view(r,seat){return{t:'state',live:r.live,names:r.seats.map(s=>s&&{n:s.name,p:s.photo}),deck:r.deck,cat:r.cat,code:r.code,seat,stage:r.stage,turn:r.turn,mine:r.secrets[seat],picked:r.secrets.map(x=>x!==null),q:r.q,a:r.a,last:r.last,
  oppOnline:!!(r.seats[1-seat]&&r.seats[1-seat].ws),over:r.stage==='over'?{winner:r.winner,secrets:r.secrets}:null}}
function push(r){r.seats.forEach((s,i)=>s&&send(s.ws,view(r,i)));r.touched=Date.now()}
function reset(r){r.deck=makeDeck(r.cat,r.custom);r.secrets=[null,null];r.turn=0;r.q=r.a=r.last=null;r.winner=null;r.stage='pick'}
function act(r,seat,m){const my=r.turn===seat;
  if(m.t==='pick'&&r.stage==='pick'&&r.secrets[seat]===null&&m.id>=0&&m.id<24){r.secrets[seat]=m.id|0;if(r.secrets.every(x=>x!==null)){r.stage='ask';r.turn=Math.random()<.5?0:1}}
  else if(m.t==='ask'&&r.stage==='ask'&&my&&typeof m.text==='string'&&m.text.trim()){r.q=m.text.trim().slice(0,120);r.a=null;r.last=null;r.stage='answer'}
  else if(m.t==='reply'&&r.stage==='answer'&&!my&&(m.a==='Да'||m.a==='Нет')){r.a=m.a;r.stage='mark'}
  else if(m.t==='end'&&(r.stage==='mark'||(r.live&&r.stage==='ask'))&&my){r.turn=1-r.turn;r.stage='ask';r.q=r.a=null}
  else if(m.t==='guess'&&(r.stage==='ask'||r.stage==='mark')&&my){
    if(m.id===r.secrets[1-seat]){r.stage='over';r.winner=seat}
    else{r.last={seat,id:m.id};r.turn=1-r.turn;r.stage='ask';r.q=r.a=null}}
  else if(m.t==='again'&&r.stage==='over')reset(r);
  else return;
  push(r)}
wss.on('connection',ws=>{let room=null,seat=-1;
  ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return}
    if(m.t==='join'&&typeof m.token==='string'){
      const r=m.create?(()=>{const c=newCode(),x={code:c,seats:[null,null],stage:'lobby',cat:CARDS[m.cat]?m.cat:'all',live:!!m.live,custom:m.cat==='custom'?cleanCustom(m.custom):null};reset(x);x.stage='lobby';rooms.set(c,x);return x})():rooms.get(String(m.room||'').toUpperCase());
      if(!r)return send(ws,{t:'err',m:'Комната не найдена'});
      let i=r.seats.findIndex(s=>s&&s.token===m.token);
      if(i<0){i=r.seats.findIndex(s=>!s);if(i<0)return send(ws,{t:'err',m:'Комната заполнена'});r.seats[i]={token:m.token}}
      r.seats[i].ws=ws;r.seats[i].name=String(m.name||'Игрок').slice(0,30);r.seats[i].photo=/^https:\/\/t\.me\/i\/userpic\//.test(m.photo)?m.photo:'';room=r;seat=i;
      if(r.seats[0]&&r.seats[1]&&r.stage==='lobby')r.stage='pick';
      return push(r)}
    if(room)act(room,seat,m)});
  ws.on('close',()=>{if(room&&room.seats[seat]&&room.seats[seat].ws===ws){room.seats[seat].ws=null;push(room)}})});
setInterval(()=>{for(const[c,r]of rooms)if(Date.now()-(r.touched||0)>6*3600e3)rooms.delete(c)},600e3);
async function api(m,b){const r=await fetch(`https://api.telegram.org/bot${TOKEN}/${m}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});return r.json()}
async function poll(){let off=0;
  await api('setChatMenuButton',{menu_button:{type:'web_app',text:'Играть',web_app:{url:URL_}}}).catch(()=>{});
  for(;;){try{const r=await api('getUpdates',{offset:off,timeout:30,allowed_updates:['message']});
    for(const u of r.result||[]){off=u.update_id+1;const m=u.message;
      if(m&&m.text&&m.text.startsWith('/start'))api('sendMessage',{chat_id:m.chat.id,text:'🎭 Угадай кто? Создай комнату и отправь ссылку другу.',reply_markup:{inline_keyboard:[[{text:'🎮 Играть',web_app:{url:URL_}}]]}})}}
    catch(e){await new Promise(r=>setTimeout(r,3000))}}}
srv.listen(PORT,()=>console.log('port',PORT));
if(TOKEN&&URL_)poll();else console.log('BOT_TOKEN/WEBAPP_URL не заданы — работает только веб-версия');
