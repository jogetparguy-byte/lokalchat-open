// Isolated interaction fixture; never imported by production routes.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ChatWindow, type MessageRow} from '../../src/components/dashboard/ChatWindow';
import '../../src/styles.css';
const chat = {id:'chat-1',customer_name:'Aina',customer_phone:'+60123456789',is_bot_active:false,last_message:null,updated_at:'2026-10-24'};
function Harness() {
 const [messages,setMessages]=useState<MessageRow[]>([]);
 const [sending,setSending]=useState(false);
 const [retrying,setRetrying]=useState<string|null>(null);
 const [mode,setMode]=useState('failed');
 const [calls,setCalls]=useState<string[]>([]);
 return <><label>Outcome<select aria-label="Outcome" value={mode} onChange={e=>setMode(e.target.value)}><option>failed</option><option>unknown</option><option>sent</option></select></label><output data-testid="calls">{JSON.stringify(calls)}</output>
 <ChatWindow chat={chat} messages={messages} sending={sending} toggling={false} retryingId={retrying} loading={false} onToggleBot={()=>{}} onSend={async(text,requestId)=>{
 setSending(true);setCalls(c=>[...c,requestId]);
 try { await new Promise(r=>setTimeout(r,150));if(mode==='unknown')throw new Error('network');
 setMessages(rows=>[...rows,{id:requestId,chat_id:chat.id,sender:'human',text,created_at:'2026-10-24',delivery_status:mode==='sent'?'sent':'failed',last_delivery_error:'Provider unavailable',sent_at:null,delivery_attempts:1}]);
 return {ok:mode==='sent',messageId:requestId,deliveryStatus:mode};
 }finally{setSending(false)}
 }} onRetry={id=>{setRetrying(id);setTimeout(()=>{setMessages(rows=>rows.map(r=>r.id===id?{...r,delivery_status:'sent',delivery_attempts:2}:r));setRetrying(null)},200)}}/>
 </>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
