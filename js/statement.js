// statement.js - reads a bank statement (PDF, CSV, XLS, XLSX) on the device and turns it into review lines.
// No AI and no upload: the file never leaves the phone. pdf.js and SheetJS are loaded only when a file is picked.
// Rule-based: Turkish bank layouts, instalment marks ("3/6"), refunds, card payments, duplicates against the ledger.
//   MX.read(file)            -> { rows, meta, kind, head, all, name }
//   MX.build(res, options)   -> { rows (review lines), purch (purchases a refund can be linked to) }
//   MX.payload(rows, pm)     -> the lines the user kept
// options = { pm, credit, ctx: { rows, merchants, rules, transfers }, exp, inc, pms, fallbackExp, fallbackInc, feeCat, interestCat }
export const MX=(function(){
  const PDFJS="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/",XLSXJS="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  const pad=n=>String(n).padStart(2,"0");
  const up=s=>String(s==null?"":s).toLocaleUpperCase("tr");
  const FOLD={"Ç":"C","Ğ":"G","İ":"I","Ö":"O","Ş":"S","Ü":"U","Â":"A","Î":"I","Û":"U"};
  const fold=s=>up(s).replace(/[ÇĞİÖŞÜÂÎÛ]/g,c=>FOLD[c]);
  const compact=s=>fold(s).replace(/[^A-Z0-9]/g,"");
  const toks=s=>fold(s).split(/[^A-Z0-9]+/).filter(t=>t.length>=2);
  const r2=n=>Math.round(n*100)/100;

  /* ---------- small parsers ---------- */
  const TRM=["OCAK","SUBAT","MART","NISAN","MAYIS","HAZIRAN","TEMMUZ","AGUSTOS","EYLUL","EKIM","KASIM","ARALIK"],ENM=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  function ymd(y,m,d){y=+y;m=+m;d=+d;if(y<100)y+=2000;if(!(y>1990&&y<2100&&m>=1&&m<=12&&d>=1&&d<=31))return null;const t=new Date(y,m-1,d);return t.getMonth()===m-1?y+"-"+pad(m)+"-"+pad(d):null}
  function parseDate(v,opt){
    if(v instanceof Date&&!isNaN(v))return v.getFullYear()+"-"+pad(v.getMonth()+1)+"-"+pad(v.getDate());
    if(typeof v==="number"&&v>30000&&v<60000&&!(opt==="strict"&&Math.floor(v)===v)){const t=new Date(Math.round((v-25569)*86400000));return t.getUTCFullYear()+"-"+pad(t.getUTCMonth()+1)+"-"+pad(t.getUTCDate())}
    const s=String(v==null?"":v).trim();let m;
    if((m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)))return ymd(m[1],m[2],m[3]);
    if((m=s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/)))return ymd(m[3],m[2],m[1]);
    if((m=fold(s).match(/^(\d{1,2})\s+([A-Z]{3,8})\s+(\d{4})/))){const k=TRM.findIndex(x=>x.indexOf(m[2])===0&&m[2].length>=3),e=ENM.indexOf(m[2].slice(0,3));const mo=k>-1?k+1:e>-1?e+1:0;return mo?ymd(m[3],mo,m[1]):null}
    return null}
  const MONEY=/^[-+(]?\s*(?:\d{1,3}(?:[.,\s]\d{3})+|\d+)[.,]\d{2}\s*\)?\s*-?\s*(?:TL|TRY|₺)?\s*[-+]?$/i;
  function parseAmt(v){
    if(typeof v==="number")return Number.isFinite(v)?v:null;
    let s=String(v==null?"":v).trim();if(!s)return null;
    const neg=/^-|^\(|-\s*(?:TL|TRY|₺)?$|\)$/i.test(s);
    s=s.replace(/[^\d.,]/g,"");if(!/\d/.test(s))return null;
    const c=s.lastIndexOf(","),d=s.lastIndexOf(".");
    if(c>-1&&d>-1){const dec=c>d?",":".";s=s.split(dec===","?".":",").join("").replace(dec,".")}
    else if(c>-1||d>-1){const sep=c>-1?",":".",parts=s.split(sep);s=parts.length===2&&parts[1].length<=2?parts[0]+"."+parts[1]:parts.join("")}
    const n=Number(s);return Number.isFinite(n)?(neg?-n:n):null}
  const addMonthsYmd=(s,k)=>{const[y,m,d]=s.split("-").map(Number);const t=new Date(y,m-1+k,Math.min(d,new Date(y,m+k,0).getDate()));return t.getFullYear()+"-"+pad(t.getMonth()+1)+"-"+pad(t.getDate())};
  const dayDiff=(a,b)=>Math.round((new Date(a+"T12:00:00")-new Date(b+"T12:00:00"))/86400000);
  const INST=/^\(?\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\)?$/;
  const instOf=s=>{const m=String(s).trim().match(INST);if(!m)return null;const no=+m[1],of=+m[2];return no>=1&&of>=2&&of<=36&&no<=of?{no,of}:null};

  /* ---------- library loading ---------- */
  const loaded={};
  function script(src){return loaded[src]||(loaded[src]=new Promise((ok,no)=>{const e=document.createElement("script");e.src=src;e.onload=ok;e.onerror=()=>{delete loaded[src];no(new Error("Could not load the file reader. Check your internet connection."))};document.head.appendChild(e)}))}
  async function pdfLib(){
    await script(PDFJS+"pdf.min.js");const lib=window.pdfjsLib;
    if(!lib.GlobalWorkerOptions.workerSrc){try{const r=await fetch(PDFJS+"pdf.worker.min.js");lib.GlobalWorkerOptions.workerSrc=URL.createObjectURL(new Blob([await r.text()],{type:"text/javascript"}))}catch(e){lib.GlobalWorkerOptions.workerSrc=PDFJS+"pdf.worker.min.js"}}
    return lib}
  async function xlsxLib(){await script(XLSXJS);return window.XLSX}

  /* ---------- Turkish letters that some bank PDFs ship without a Unicode map ---------- */
  // Arial / Helvetica advance widths (1/1000 em), regular and bold
  const TRW={U:{"İ":[278,278],"Ş":[667,667],"Ç":[722,722],"Ü":[722,722],"Ö":[778,778],"Ğ":[778,778]},
             L:{"ç":[500,556],"ş":[500,556],"ğ":[556,611],"ü":[556,611],"ö":[556,611],"ı":[222,278]}};
  const VOW="AEIİOÖUÜ",FRONT="EİÖÜ",BACK="AIOU";
  const DICT=("ÖDEME ÖDEMENİZ ÖDEMESİ TEŞEKKÜR TEŞEKKÜRLER EDERİZ ÖNCEKİ DÖNEM DÖNEMİ BORÇ BORCU BORCUNUZ ÖZET ÖZETİ ÖZETİNİZ İŞLEM İŞLEMİ İŞLEMLER AÇIKLAMA AÇIKLAMASI "+
    "MÜŞTERİ NUMARASI KARTI ALIŞVERİŞ FAİZ FAİZİ ÜCRET ÜCRETİ ÜCRETLER ÜYELİK YILLIK GECİKME ÇEKİM NAKİT KULLANILABİLİR KAZANILAN ÖZEL KARŞILIĞI BANKACILIĞI ŞİŞLİ "+
    "İSTANBUL ANKARA İZMİR BURSA ANTALYA BÜYÜK MÜKELLEFLER GEREĞİ KISITLARI ÖDENDİĞİNDEN KALDIRILMIŞTIR TARİHİ TARİHİNİZ TUTARI ASGARİ ORANI HESAP KESİM İADE İPTAL "+
    "HAVALE GİDEN GELEN ŞUBE ŞUBESİ ŞTİ ŞİRKETİ TİC TİCARET SANAYİ LİMİTED ANONİM ANONİ İNŞAAT İNŞ GIDA YİYECEK İÇECEK İÇECEKLERİ ÇİÇEK ÇİÇEKÇİLİK MAĞAZA MAĞAZASI MAĞAZACILIK "+
    "MARKET MARKETLERİ ÜRÜN ÜRÜNLERİ FIRIN BÜFE KÖFTE DÖNER KÜÇÜK ÇARŞI ÇARŞISI KÖY KÖYÜ EYÜP EYÜPSULTAN ÜSKÜDAR BEŞİKTAŞ KADIKÖY BAKIRKÖY ATAŞEHİR ÜMRANİYE ÇEKMEKÖY "+
    "BEYLİKDÜZÜ SARIYER BEYOĞLU KAĞITHANE GÜNGÖREN BAĞCILAR BAHÇELİEVLER KÜÇÜKÇEKMECE BÜYÜKÇEKMECE GAZİOSMANPAŞA BAYRAMPAŞA ZEYTİNBURNU FATİH BAŞAKŞEHİR ŞAHİN ŞAHİNLER "+
    "ÖZGÜR ÜNLÜ GÜNEŞ YEŞİL YEŞİLPINAR ALİBEYKÖY İSTİNYE MECİDİYEKÖY ÖZDİLEK ÇAĞDAŞ DOĞAN DOĞUŞ ŞOK BİM MİGROS TÜRK TÜRKİYE TÜRKCELL İGDAŞ İSKİ ECZANE ECZANESİ SAĞLIK "+
    "HASTANE HASTANESİ AKARYAKIT YIKAMA KUAFÖR GÜZELLİK GİYİM ÇANTA KİTAP KIRTASİYE ELEKTRONİK MOBİLYA BAHÇE ÇAY KAHVECİ PASTANE PASTANESİ TATLI TATLICI LOKANTA LOKANTASI "+
    "ÇİĞ KÖFTECİ DÜRÜM DÜRÜMCÜ PİDE KEBAP KEBAPÇI SÜT ŞARKÜTERİ ÇİFTLİK ÜNİVERSİTE ÜYELİĞİ ABONELİK BİLET SİNEMA TİYATRO OTELİ TURİZM HAVAYOLLARI TAKSİ OTOBÜS "+
    "İSTANBULKART YÜKLEME VERGİ HARÇ SİGORTA AİDAT FATURA FATURASI ELEKTRİK DOĞALGAZ İNTERNET HİZMET HİZMETLERİ DİŞ KLİNİK KLİNİĞİ OPTİK ÇOCUK OYUNCAK HEDİYE HEDİYELİK "+
    "ÇAMAŞIR TEMİZLEME TERZİ ÇİLİNGİR HIRDAVAT GÜMÜŞ İÇKİ GEÇİŞ KÖPRÜ İLE İÇİN GÜMRÜK LİMİTİ İNDİRİM TAKSİT TAKSİTLİ VADELİ KREDİ SANAL DÖKÜM EKSTRE EKSTRESİ "+
    "ADRESİ MAHALLESİ CADDESİ SOKAĞI DAİRE İLÇE BİNASI ŞEKER ÇİKOLATA GÜL ÇELİK ÖZTÜRK YILDIZ YILMAZ DEMİR AYDIN ÖZDEMİR KILIÇ ÇETİN KOÇ ÖZKAN ŞİMŞEK ÖZER ERDOĞAN "+
    "KÖSE ÇAKIR ÖZCAN GÜNAYDIN MÜDÜRLÜĞÜ BELEDİYESİ BAKANLIĞI DERNEĞİ VAKFI YAYINCILIK YAYINLARI GÖZLÜK MÜZİK DÜNYASI DÜNYA KÖŞE KÖŞESİ PAZARI GÜVEN GÜVENLİK İLETİŞİM "+
    "ÜRÜNLER İŞLETME İŞLETMESİ İŞLETMECİLİĞİ GÜNLÜK HAFTALIK AYLIK ŞARJ YAKIT OTOPARKI ÇİFTÇİ ÖĞRENCİ ÖĞLE AKŞAM KAHVALTI ÜCRETSİZ").split(" ");
  const DICTL=DICT.map(w=>w.length);

  function inferTurkish(lines,ph){
    const keys=Object.keys(ph);if(!keys.length)return{};
    const votes={};keys.forEach(k=>{votes[k]={}});
    const isPh=c=>!!ph[c];
    const letterCase=c=>/[A-ZÇĞİÖŞÜ]/.test(c)?"U":/[a-zçğıöşü]/.test(c)?"L":"";
    const cands=(k,cs)=>{const w=ph[k].w,out=[];["U","L"].forEach(C=>{if(cs&&cs!==C)return;Object.keys(TRW[C]).forEach(l=>{if(!w||TRW[C][l].some(x=>Math.abs(x-w)<=12))out.push(l)})});return out.length?out:Object.keys(cs==="L"?TRW.L:TRW.U)};
    const add=(k,l,v)=>{votes[k][l]=(votes[k][l]||0)+v};
    lines.forEach(L=>{
      L.text.split(/[^A-Za-z0-9ÇĞİÖŞÜçğıöşü\uE000-\uE0FF]+/).forEach(tok=>{
        if(![...tok].some(isPh))return;
        const ch=[...tok],n=ch.length;
        // case of each placeholder from its neighbours
        const cs=ch.map((c,i)=>{if(!isPh(c))return letterCase(c);const nb=(ch.slice(i+1).find(x=>!isPh(x)&&letterCase(x))||"");const pb=(ch.slice(0,i).reverse().find(x=>!isPh(x)&&letterCase(x))||"");
          const a=letterCase(pb),b=letterCase(nb);if(a&&b)return a===b?a:(i===0?"U":b);if(i===0&&b==="L")return"U";return a||b||"U"});
        // dictionary: same length, or a dictionary stem the token starts with
        const T=ch.map((c,i)=>isPh(c)?c:up(c)).join("");
        DICT.forEach((w,wi)=>{const wl=DICTL[wi];if(wl!==n&&!(wl>=5&&wl<n))return;
          const wc=[...w];let ok=true,hit=false;
          for(let i=0;i<wl&&ok;i++){const c=ch[i];if(isPh(c)){const cc=cands(c,cs[i]).map(up);if(cc.indexOf(wc[i])<0)ok=false;else hit=true}else if(up(c)!==wc[i]&&!(wc[i]==="I"&&up(c)==="I"))ok=false}
          if(!ok||!hit)return;const wgt=wl===n?6:3;
          for(let i=0;i<wl;i++){const c=ch[i];if(isPh(c)){const l=cs[i]==="L"?wc[i].toLocaleLowerCase("tr"):wc[i];add(c,l,wgt)}}});
        // sound pattern: a vowel sits between consonants, a consonant between vowels
        const vs=ch.filter(c=>!isPh(c)).map(up).join(""),front=[...vs].filter(c=>FRONT.indexOf(c)>-1).length,back=[...vs].filter(c=>BACK.indexOf(c)>-1).length;
        ch.forEach((c,i)=>{if(!isPh(c))return;const p=i>0&&!isPh(ch[i-1])?up(ch[i-1]):null,q=i<n-1&&!isPh(ch[i+1])?up(ch[i+1]):null;
          const pv=p===null?null:VOW.indexOf(p)>-1,qv=q===null?null:VOW.indexOf(q)>-1;
          cands(c,cs[i]).forEach(l=>{const L_=up(l),v=VOW.indexOf(L_)>-1||l==="ı";let s=0;
            if(pv===false&&qv===false)s+=v?1.5:-1;else if(pv===true&&qv===true)s+=v?-1.5:1.5;
            else if(i===0&&qv===true)s+=v?-1:1;else if(i===n-1&&pv===false)s+=v?1:-.5;else if(pv===null&&qv===false&&i===0)s+=v?.8:0;
            if(L_==="Ğ"&&(i===0||pv===false))s-=3;
            if(v&&L_!=="İ"&&l!=="ı"){if(front>back)s+=.5;else if(back>front)s-=.5}
            add(c,l,s)})})})});
    const ORDER="İŞÜÇÖĞşçüöğı",map={};
    keys.forEach(k=>{const v=votes[k];let best=null,bs=-1e9;Object.keys(v).sort((a,b)=>ORDER.indexOf(a)-ORDER.indexOf(b)).forEach(l=>{if(v[l]>bs){bs=v[l];best=l}});
      if(!best){const c=cands(k,"");best=c[0]}map[k]=best});
    return map}

  /* ---------- PDF ---------- */
  async function readPdf(buf){
    const lib=await pdfLib();
    let doc;try{doc=await lib.getDocument({data:new Uint8Array(buf),fontExtraProperties:true,isEvalSupported:false}).promise}
    catch(e){throw new Error(/password/i.test(e&&e.name+e.message)?"This PDF is password protected. Download it again without a password.":"This PDF could not be opened.")}
    const items=[],ph={},phOf={};let nextPh=0xE000;
    const HID=/[\u0000-\u001f\uE000-\uF8FF\uFFFD]/,O=lib.OPS;
    let wAdd=[],xSub=[];
    const phFor=(key,w)=>{if(!phOf[key]){const pc=String.fromCharCode(nextPh++);phOf[key]=pc;ph[pc]={w:Math.round(w||0)}}return phOf[key]};
    for(let p=1;p<=doc.numPages;p++){
      const pg=await doc.getPage(p),tc=await pg.getTextContent();
      const strs=tc.items.map(it=>it.str||"");
      // glyphs with no Unicode name (e.g. Turkish capitals named G0..G18) come through as control characters or spaces;
      // the drawing instructions still carry their font and code, so line both up and mark those glyphs
      let ops=null;
      try{const ol=await pg.getOperatorList();let font="";ops=[];
        for(let i=0;i<ol.fnArray.length;i++){const fn=ol.fnArray[i],a=ol.argsArray[i];
          if(fn===O.setFont)font=a[0];
          else if(fn===O.showText||fn===O.showSpacedText||fn===O.nextLineShowText||fn===O.nextLineSetSpacingShowText){
            const g=fn===O.nextLineSetSpacingShowText?a[2]:a[0];
            (g||[]).forEach(x=>{if(!x||typeof x==="number")return;const u=String(x.unicode||"");
              if(u.length===1&&HID.test(u)&&x.originalCharCode!==32)ops.push({h:font+"|"+x.originalCharCode,w:x.width});
              else for(const c of u)ops.push({c})})}}}catch(e){ops=null}
      if(ops&&ops.some(o=>o.h)){
        const flat=[];strs.forEach((st,k)=>{for(const c of st)flat.push({k,c})});
        const out=strs.map(()=>"");let j=0,pending="",pendW=0,lastK=-1;wAdd=strs.map(()=>0);xSub=strs.map(()=>0);
        const sp=c=>/\s/.test(c),nextHid=i=>{for(let z=i+1;z<flat.length;z++){if(!sp(flat[z].c))return HID.test(flat[z].c)}return false};
        const put=(k,t)=>{if(pending&&!sp(t)){out[k]+=pending;xSub[k]+=pendW;wAdd[k]+=pendW;pending="";pendW=0}out[k]+=t;if(!sp(t))lastK=k};
        // a hidden glyph that PDF.js turned into whitespace: attach it to the text it is drawn next to
        const attach=(k,o)=>{const prev=ops[j-1],next=ops[j+1],pc=phFor(o.h,o.w);
          if(lastK>-1&&((prev&&!prev.h&&!sp(prev.c))||(prev&&prev.h&&!(next&&!next.h&&!sp(next.c))))){out[lastK]+=pc;wAdd[lastK]+=o.w||0}else{pending+=pc;pendW+=o.w||0}};
        for(let i=0;i<flat.length;i++){const {k,c}=flat[i];let guard=0;
          for(;;){const op=ops[j];if(++guard>40||!op){put(k,HID.test(c)?phFor(tc.items[k].fontName+"|"+c.charCodeAt(0),0):c);break}
            if(HID.test(c)){if(op.h){put(k,phFor(op.h,op.w));j++;break}if(sp(op.c)){j++;continue}
              let f=-1;for(let z=j;z<Math.min(ops.length,j+6);z++)if(ops[z].h){f=z;break}if(f>-1){j=f;continue}put(k,phFor(tc.items[k].fontName+"|"+c.charCodeAt(0),0));break}
            if(sp(c)){
              if(op.h){if(nextHid(i)){put(k," ");break}attach(k,op);j++;
                while(ops[j]&&ops[j].h&&!nextHid(i)){attach(k,ops[j]);j++}break}
              if(sp(op.c)){put(k,c);j++;while(ops[j]&&!ops[j].h&&sp(ops[j].c)&&i+1<flat.length&&!sp(flat[i+1].c))j++;break}
              put(k," ");break}
            if(op.c===c){put(k,c);j++;break}
            if(sp(op.c)){j++;continue}
            if(op.h){attach(k,op);j++;continue}
            let f=-1;for(let z=j;z<Math.min(ops.length,j+6);z++)if(!ops[z].h&&ops[z].c===c){f=z;break}
            if(f>-1){j=f;continue}put(k,c);break}}
        if(pending&&lastK>-1)out[lastK]+=pending;
        out.forEach((o,k)=>{strs[k]=o})}
      tc.items.forEach((it,k)=>{const str=strs[k];if(!str||!str.replace(/\s/g,""))return;
        const t=it.transform,size=Math.hypot(t[2],t[3])||Math.hypot(t[0],t[1])||10;
        let s="";for(const c of str){
          if(c>="\uE000"&&c<="\uE0FF"&&ph[c])s+=c;
          else if(HID.test(c)){s+=phFor(it.fontName+"|"+c.charCodeAt(0),str.length===1?it.width/size*1000:0)}
          else s+=c}
        items.push({p,x:t[4]-(xSub[k]||0)*size/1000,y:t[5],w:it.width+(wAdd[k]||0)*size/1000,size,s})});wAdd=[];xSub=[]}
    if(!items.length)throw new Error("This PDF has no readable text (it looks scanned). Download the statement again from internet banking, or as Excel / CSV.");
    // rebuild lines and cells
    items.sort((a,b)=>a.p-b.p||b.y-a.y||a.x-b.x);
    const lines=[];
    items.forEach(it=>{let L=lines.length?lines[lines.length-1]:null;
      if(!L||L.p!==it.p||Math.abs(L.y-it.y)>Math.max(2,it.size*.45)){L={p:it.p,y:it.y,size:it.size,its:[]};lines.push(L)}L.its.push(it)});
    lines.forEach(L=>{L.its.sort((a,b)=>a.x-b.x);const cells=[];
      L.its.forEach(it=>{const c=cells[cells.length-1],gap=c?it.x-c.x1:1e9;
        if(c&&gap<it.size*1.1){c.s+=(gap>it.size*.18&&!/\s$/.test(c.s)&&!/^\s/.test(it.s)?" ":"")+it.s;c.x1=Math.max(c.x1,it.x+it.w)}
        else cells.push({s:it.s,x0:it.x,x1:it.x+it.w})});
      cells.forEach(c=>{c.s=c.s.replace(/\s+/g," ").trim().replace(/^:\s*/,"")});L.cells=cells.filter(c=>c.s&&!/^bosluk$/i.test(c.s));L.text=L.cells.map(c=>c.s).join("  ")});
    for(let i=lines.length-1;i>=0;i--)if(!lines[i].cells.length)lines.splice(i,1);
    // repair Turkish letters
    const map=inferTurkish(lines,ph),keys=Object.keys(map);
    if(keys.length){const fix=s=>s.replace(/[\uE000-\uF8FF]/g,c=>map[c]||c);lines.forEach(L=>{L.cells.forEach(c=>{c.s=fix(c.s)});L.text=fix(L.text)})}
    return{kind:"pdf",lines,fixed:keys.length}}

  const HEAD={date:/^(ISLEM )?TARIH|^DATE|TARIHI$|^ISLEM TARIHI/,desc:/ACIKLAMA|ACIKLAMASI|DESCRIPTION|ISYERI|ISLEM DETAY|DETAY|MERCHANT|^ISLEM$|ALICI|GONDEREN/,amt:/^TUTAR|TUTARI$|^AMOUNT|^ISLEM TUTARI|^TL TUTAR|^MIKTAR/,
    debit:/^BORC|^GIDEN|^CIKAN|^CIKIS|^DEBIT|^HARCAMA/,credit:/^ALACAK|^GELEN|^GIREN|^GIRIS|^CREDIT/,inst:/TAKSIT/,bal:/BAKIYE|BALANCE/,pts:/PUAN|POINT|BONUS|MIL/};
  const headKind=s=>{const f=fold(s).replace(/\s+/g," ").trim();if(!f||f.length>40)return"";if(HEAD.bal.test(f))return"bal";if(HEAD.pts.test(f)&&!HEAD.amt.test(f))return"pts";if(HEAD.inst.test(f)&&!/TUTAR/.test(f))return"inst";
    if(HEAD.date.test(f)&&!/VALOR|KESIM|SON ODEME/.test(f))return"date";if(HEAD.debit.test(f))return"debit";if(HEAD.credit.test(f))return"credit";if(HEAD.amt.test(f))return"amt";if(HEAD.desc.test(f))return"desc";return""};

  const UNDATED=/^(DONEM FAIZI|AKDI FAIZ|GECIKME FAIZI|NAKIT AVANS FAIZI|TAKSIT FAIZI|FAIZ\b|KKDF|BSMV|KART UCRETI|YILLIK|UYELIK|HESAP ISLETIM|KOMISYON|UCRET)/;
  const GI=/\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*[xX]\s*(\d{1,2})\s*=\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*(\d{1,2})\s*\.?\s*TAKS[İIiı]T/i;
  function pdfLines(doc){
    const L=doc.lines,out=[];let head=null,sec="",meta={},cont=null;
    L.forEach(l=>{const f=fold(l.text);
      if(/HESAP KESIM TARIHI|KESIM TARIHI/.test(f)&&!meta.cut){const m=l.text.match(/(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]{3,9}\s+\d{4})/);if(m)meta.cut=parseDate(m[1])}
      if(!meta.last4){const m=l.text.match(/\b\d{4}\s?(?:\d{2}[*X]{2}|[*X]{4})\s?[*X]{4}\s?(\d{4})\b/i);if(m)meta.last4=m[1]}
      if(meta.prev==null&&/ONCEKI (DONEM |HESAP |EKSTRE |AY )*(HESAP OZETI |EKSTRE )?(BAKIYE|BORC)|ONCEKI DONEMDEN DEVIR|DEVREDEN BAKIYE|DEVIR EDILEN/.test(f)){const mm=l.cells.map(c=>c.s).filter(s=>MONEY.test(s));if(mm.length)meta.prev=parseAmt(mm[mm.length-1])}
      if(meta.debt==null&&/^DONEM BORCU|DONEM BORCU\s|TOPLAM BORC|HESAP KESIM TARIHINDEKI BORC|GUNCEL DONEM BORCU/.test(f)){const mm=l.cells.map(c=>c.s.replace(/\s*(TL|TRY)$/i,"")).filter(s=>MONEY.test(s));if(mm.length)meta.debt=parseAmt(mm[0])}
      // column header
      const kinds=l.cells.map(c=>headKind(c.s));
      if(kinds.indexOf("date")>-1&&(kinds.indexOf("amt")>-1||kinds.indexOf("debit")>-1)){head={};l.cells.forEach((c,i)=>{const k=kinds[i];if(k&&!head[k])head[k]=(c.x0+c.x1)/2});cont=null;return}
      if(/^(SANAL KART|EK KART|ASIL KART)/.test(f)&&!parseDate(l.cells[0].s)){sec=/^SANAL/.test(f)?"Virtual card":/^EK/.test(f)?"Additional card":"";cont=null;return}
      const c0=l.cells[0]?l.cells[0].s:"";let dm=c0.match(/^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]{3,9}\.?\s+\d{4})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?\s*(.*)$/),und=false;
      // interest / fee lines printed without a date belong to the cut-off date
      if(!dm&&meta.cut&&head&&head.amt!=null&&UNDATED.test(f)&&l.cells.length>=2&&MONEY.test(l.cells[l.cells.length-1].s.replace(/\s+(TL|TRY)$/i,""))){dm=["",meta.cut,"",""];und=true}
      if(!dm){
        // a wrapped description continues on the next line
        if(cont&&l.p===cont.p&&cont.y-l.y<l.size*1.9&&!l.cells.some(c=>MONEY.test(c.s))&&l.cells.length<=2&&Math.abs(l.cells[0].x0-cont.dx)<Math.max(3,l.size*.6)&&l.text.length<60){cont.row.desc+=" "+l.text;cont.y=l.y}else cont=null;
        return}
      let d=parseDate(dm[1]);if(!d){cont=null;return}
      const cells=l.cells.slice(und?0:1);let rest=(dm[3]||"").trim();
      if(rest){const m2=rest.match(/^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\s*(.*)$/);if(m2)rest=m2[2]}   // valör date
      else if(cells[0]&&parseDate(cells[0].s)&&/^\d/.test(cells[0].s)&&cells[0].s.length<=10)cells.shift();
      const money=[],other=[];
      cells.forEach(c=>{const s=c.s.replace(/\s+(TL|TRY)$/i,"");if(MONEY.test(s))money.push({c,v:parseAmt(s)});else other.push(c)});
      // a money value glued to the end of the description cell
      if(!money.length){const tail=(rest+" "+other.map(c=>c.s).join(" ")).match(/^(.*?)\s+(-?[\d.,]+[.,]\d{2}-?)\s*(TL|TRY)?\s*(\d{1,2}\/\d{1,2})?$/i);
        if(tail){rest=tail[1];other.length=0;money.push({c:{x0:0,x1:0},v:parseAmt(tail[2])});if(tail[4])other.push({s:tail[4],x0:1e9,x1:1e9})}else{cont=null;return}}
      const near=(x,list)=>list.slice().sort((a,b)=>Math.abs((a.c.x0+a.c.x1)/2-x)-Math.abs((b.c.x0+b.c.x1)/2-x))[0];
      let amt=null,dir=0;
      if(head&&head.debit!=null&&head.credit!=null){const a=near(head.debit,money),b=near(head.credit,money);const pick=Math.abs((a.c.x0+a.c.x1)/2-head.debit)<=Math.abs((b.c.x0+b.c.x1)/2-head.credit)?a:b;amt=Math.abs(pick.v);dir=pick===a?1:-1}
      else if(head&&head.amt!=null){const ms=head.bal!=null?money.filter(m=>m!==near(head.bal,money)||money.length===1):money;amt=(near(head.amt,ms.length?ms:money)).v}
      else{const ms=money.length>1&&head&&head.bal!=null?money.slice(0,-1):money;amt=ms[0].v}
      if(amt==null||amt===0){cont=null;return}
      const amtCell=money.filter(m=>m.v===amt||Math.abs(m.v)===amt).sort((a,b)=>head&&head.amt!=null?Math.abs((a.c.x0+a.c.x1)/2-head.amt)-Math.abs((b.c.x0+b.c.x1)/2-head.amt):0)[0]||money[0];
      const plus=/^\+|\+\s*(TL|TRY|₺)?\s*$/i.test(amtCell.c.s);
      const descCells=other.filter(c=>c.x1<=amtCell.c.x0+2||!amtCell.c.x1);
      let desc=(rest+" "+descCells.map(c=>c.s).join(" ")).replace(/\s+/g," ").trim(),inst=null,d0="";
      other.forEach(c=>{if(!inst&&c.x0>=amtCell.c.x0-2){const z=instOf(c.s);if(z)inst=z}});
      if(!inst&&head&&head.inst!=null)other.forEach(c=>{if(!inst&&Math.abs((c.x0+c.x1)/2-head.inst)<40){const z=instOf(c.s);if(z)inst=z}});
      const gi=desc.match(GI);
      if(gi&&!inst){const z=instOf(gi[4]+"/"+gi[2]);if(z){inst=z;desc=desc.replace(gi[0],"").trim()}}
      // "1. Taksit" in the description (+ "6x502.00" remaining in the Kalan Taksit column) or "6.Tk" (Peşine Taksit)
      let ino=0;
      if(!inst){const k=desc.match(/\s*\b(\d{1,2})\s*\.\s*(?:TAKS[İIiı]T|TK)\b\.?/i);if(k){ino=+k[1];desc=desc.replace(k[0]," ").replace(/\s*\bPEŞ\.?\s*TAKS[İIiı]T\b|\s*\bANAPARA\b/gi,"").replace(/\s+/g," ").trim();
        const rm=other.filter(c=>c.x0>=amtCell.c.x0-2).map(c=>c.s.match(/^(\d{1,2})\s*[xX]\s*\d[\d.,]*$/)).filter(Boolean)[0];
        if(rm){const z=instOf(ino+"/"+(ino+ +rm[1]));if(z){inst=z;ino=0}}else if(ino===1){ino=0}}}
      const tm=desc.match(/\s*\(?(?:TAKSIT|TKS|TAKS)\.?\s*(\d{1,2})\s*\/\s*(\d{1,2})\)?|\s+(\d{1,2})\s*\/\s*(\d{1,2})\s*(?:TAKSIT|TKS)\b/i);
      if(tm){const z=instOf((tm[1]||tm[3])+"/"+(tm[2]||tm[4]));if(z&&!inst){inst=z;desc=desc.replace(tm[0],"").trim()}}
      // a later instalment printed with its own (posting) date: the purchase was no-1 months earlier;
      // printed with the purchase date (long before the cut-off): keep it
      const recent=meta.cut?dayDiff(meta.cut,d)<=45:true;
      if(inst&&inst.no>1&&recent){d0=d;d=addMonthsYmd(d,-(inst.no-1))}
      if(!inst&&ino>1){if(!recent)d=addMonthsYmd(d,ino-1);desc+=" · Taksit "+ino}
      const row={d,d0,desc,amt,dir,inst,card:sec,plus};
      if(/^(ONCEKI DONEM|DEVREDEN|TOPLAM|GENEL TOPLAM|DONEM BORCU|ASGARI)/.test(fold(desc))){cont=null;return}
      out.push(row);cont={row,p:l.p,y:l.y,dx:(descCells[0]||{x0:0}).x0}});
    if(out.some(r=>r.plus))out.forEach(r=>{r.dir=r.plus?-1:1});
    out.forEach(r=>{delete r.plus});
    return{rows:out,meta}}

  /* ---------- CSV / XLS / XLSX ---------- */
  function decodeText(buf){const b=new Uint8Array(buf);
    if(b[0]===0xFF&&b[1]===0xFE)return new TextDecoder("utf-16le").decode(b);
    try{return new TextDecoder("utf-8",{fatal:true}).decode(b).replace(/^﻿/,"")}catch(e){}
    try{return new TextDecoder("windows-1254").decode(b)}catch(e){return new TextDecoder("iso-8859-9").decode(b)}}
  function parseCsv(text){
    const ls=text.split(/\r\n|\n|\r/).filter(l=>l.trim()).slice(0,30);
    let sep=";",best=-1;[";",",","\t","|"].forEach(s=>{const n=ls.map(l=>splitCsv(l,s).length);const mode=n.sort((a,b)=>n.filter(x=>x===b).length-n.filter(x=>x===a).length)[0];const sc=mode>1?n.filter(x=>x===mode).length*10+mode:0;if(sc>best){best=sc;sep=s}});
    const rows=[];let cur=[],f="",q=false;
    for(let i=0;i<text.length;i++){const c=text[i];
      if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=c}
      else if(c==='"')q=true;else if(c===sep){cur.push(f);f=""}else if(c==="\n"||c==="\r"){if(c==="\r"&&text[i+1]==="\n")i++;cur.push(f);rows.push(cur);cur=[];f=""}else f+=c}
    if(f||cur.length){cur.push(f);rows.push(cur)}
    return rows.map(r=>r.map(x=>x.trim()))}
  function splitCsv(l,s){const o=[];let f="",q=false;for(const c of l){if(c==='"')q=!q;else if(c===s&&!q){o.push(f);f=""}else f+=c}o.push(f);return o}
  async function readSheet(buf,name){
    let rows;
    if(/\.(csv|txt)$/i.test(name))rows=parseCsv(decodeText(buf));
    else{const X=await xlsxLib();let wb;try{wb=X.read(new Uint8Array(buf),{type:"array",cellDates:false,codepage:1254})}catch(e){throw new Error("This spreadsheet could not be opened.")}
      let bestRows=null,bs=-1;wb.SheetNames.forEach(sn=>{const r=X.utils.sheet_to_json(wb.Sheets[sn],{header:1,raw:true,defval:""});const sc=r.filter(x=>x.some(v=>parseDate(v))).length;if(sc>bs){bs=sc;bestRows=r}});rows=bestRows||[]}
    return tableRows(rows)}
  function tableRows(rows){
    rows=rows.map(r=>r.map(v=>typeof v==="string"?v.replace(/\s+/g," ").trim():v));
    const meta={};
    rows.slice(0,40).forEach(r=>{const t=r.join(" ");if(!meta.last4){const m=t.match(/\b\d{4}\s?\d{2}[*X]{2}\s?[*X]{4}\s?(\d{4})\b/i);if(m)meta.last4=m[1]}});
    // header row
    let hi=-1,col={};
    for(let i=0;i<Math.min(rows.length,60)&&hi<0;i++){const k=rows[i].map(c=>typeof c==="string"?headKind(c):"");
      if(k.indexOf("date")>-1&&(k.indexOf("amt")>-1||k.indexOf("debit")>-1||k.indexOf("credit")>-1)){hi=i;k.forEach((x,j)=>{if(x&&col[x]==null)col[x]=j});
        if(col.desc==null){const texts=rows.slice(i+1,i+30);let bj=-1,bl=0;rows[i].forEach((_,j)=>{if(Object.values(col).indexOf(j)>-1)return;const avg=texts.reduce((s,r)=>s+(typeof r[j]==="string"&&!parseDate(r[j])&&parseAmt(r[j])==null?r[j].length:0),0);if(avg>bl){bl=avg;bj=j}});if(bj>-1)col.desc=bj}}}
    if(hi<0){ // no header: infer from the values
      const body=rows.filter(r=>r.some(v=>parseDate(v))),w=Math.max(0,...body.map(r=>r.length));
      const st=[];for(let j=0;j<w;j++){let dt=0,nm=0,tx=0;body.forEach(r=>{const v=r[j];if(parseDate(v,typeof v==="number"?"":"strict"))dt++;else if(typeof v==="number"||(typeof v==="string"&&MONEY.test(v)))nm++;else if(typeof v==="string"&&v.length>2)tx+=v.length});st.push({j,dt,nm,tx})}
      const dc=st.slice().sort((a,b)=>b.dt-a.dt)[0];if(!dc||dc.dt<1)throw new Error("No transactions found in this file.");
      const nums=st.filter(s=>s.j!==dc.j&&s.nm>=body.length*.5).map(s=>s.j);
      col.date=dc.j;col.desc=(st.filter(s=>s.j!==dc.j&&nums.indexOf(s.j)<0).sort((a,b)=>b.tx-a.tx)[0]||{}).j;
      col.amt=nums[0];
      if(nums.length>1){const vals=j=>body.map(r=>parseAmt(r[j])||0);const a=vals(nums[0]),b=vals(nums[1]);let hit=0;for(let i=1;i<a.length;i++){const db=b[i]-b[i-1];if(Math.abs(Math.abs(db)-Math.abs(a[i]))<.011)hit++}
        if(hit<(a.length-1)*.6){let hit2=0;for(let i=1;i<b.length;i++){const da=a[i]-a[i-1];if(Math.abs(Math.abs(da)-Math.abs(b[i]))<.011)hit2++}if(hit2>=(b.length-1)*.6)col.amt=nums[1]}}
      if(col.amt==null)throw new Error("No amount column found in this file.");hi=-1}
    const out=[];
    rows.slice(hi+1).forEach(r=>{const d=parseDate(r[col.date]);if(!d)return;
      let amt=null,dir=0;
      if(col.debit!=null||col.credit!=null){const a=col.debit!=null?parseAmt(r[col.debit]):null,b=col.credit!=null?parseAmt(r[col.credit]):null;
        if(a)  {amt=Math.abs(a);dir=1}else if(b){amt=Math.abs(b);dir=-1}else if(col.amt!=null)amt=parseAmt(r[col.amt])}
      else amt=parseAmt(r[col.amt]);
      if(amt==null||amt===0)return;
      let desc=String(col.desc!=null?r[col.desc]:"").replace(/\s+/g," ").trim(),inst=null;
      if(col.inst!=null){const v=r[col.inst];inst=instOf(v);if(!inst&&typeof v==="number"&&v>=2&&v<=36)inst={no:1,of:v}}
      const tm=desc.match(/\s*\(?(?:TAKSIT|TKS)\.?\s*(\d{1,2})\s*\/\s*(\d{1,2})\)?/i);if(tm&&!inst){inst=instOf(tm[1]+"/"+tm[2]);if(inst)desc=desc.replace(tm[0],"").trim()}
      if(/^(ONCEKI DONEM|DEVREDEN|TOPLAM|GENEL TOPLAM|DONEM BORCU)/.test(fold(desc)))return;
      out.push({d,desc,amt,dir,inst,card:""})});
    const headTxt=rows.slice(0,hi>0?hi:0).map(r=>r.join(" ")).join(" ").slice(0,600);
    return{kind:"sheet",rows:out,meta,head:headTxt}}

  /* ---------- read any statement file ---------- */
  async function read(file){
    const buf=await file.arrayBuffer(),name=String(file.name||"");
    const isPdf=/\.pdf$/i.test(name)||(new Uint8Array(buf.slice(0,5)).join(",")==="37,80,68,70,45");
    let res;
    if(isPdf){const doc=await readPdf(buf);res=pdfLines(doc);res.kind="pdf";res.fixed=doc.fixed;const first=doc.lines.findIndex(l=>{const t=l.cells[0]?l.cells[0].s:"";return /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(t)||(/^\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]{3,9}\s+\d{4}/.test(t)&&!!parseDate(t))});res.head=doc.lines.slice(0,first>0?Math.min(first,25):12).map(l=>l.text).join("\n");res.all=doc.lines.map(l=>l.text).join("\n").slice(0,30000)}
    else if(/\.(xlsx|xlsm|xls|csv|txt)$/i.test(name)){res=await readSheet(buf,name)}
    else throw new Error("Choose a PDF, CSV, XLS or XLSX file.");
    if(!res.rows.length)throw new Error("No transactions found in this file. If it is a PDF, try the Excel / CSV download from internet banking.");
    res.name=name;return res}

  // payment method named in the file (e.g. "QNB"), best match by number of mentions;
  // otherwise the bank that issued the statement, matched to an account named after the bank or its card brand
  const BANKS=[[/GARANTI ?BANKASI|GARANTIBBVA|GARANTI BBVA|BONUSFLAS/,["BONUS","GARANTI","MILESSMILES","SHOPANDFLY","FLEXICARD","MONEYCARD"]],
    [/YAPI ?(VE )?KREDI|YAPIKREDI|WORLDCARD/,["PLAY","WORLD","YAPIKREDI","YKB","ADIOS","CRYSTAL","OPET"]],
    [/VAKIFBANK|VAKIFKART|VAKIFLAR BANKASI/,["RAILMILES","VAKIF","VAKIFBANK"]],
    [/DENIZBANK/,["DENIZ","DENIZBANK","DENIZKART","FASTPAY","BLACK"]],
    [/QNB|FINANSBANK|CARDFINANS|ENPARA/,["QNB","FINANS","CARDFINANS","ENPARA"]],
    [/AKBANK/,["AXESS","WINGS","AKBANK","FREE"]],
    [/IS BANKASI|ISBANK|MAXIMUM KART|MAXIMUMKART/,["MAXIMUM","ISBANK","MAXI","ISBANKASI"]],
    [/HALKBANK|PARAF/,["PARAF","HALK","HALKBANK"]],
    [/ZIRAAT|BANKKART/,["BANKKART","ZIRAAT"]],
    [/ING BANK|INGBANK/,["ING"]],[/\bTEB\b|CEPTETEB/,["TEB","CEPTETEB"]],[/KUVEYT/,["KUVEYT","SAGLAMKART"]],[/ALBARAKA/,["ALBARAKA"]],[/ODEABANK/,["ODEA"]]];
  function detectPm(res,pms){const lines=String(res.head||"").split("\n").map(compact),fn=compact(res.name);let best="",bs=0;
    (pms||[]).forEach(p=>{const c=compact(p);if(c.length<3)return;let n=fn.indexOf(c)>-1?20:0;lines.forEach((l,i)=>{n+=(l.split(c).length-1)*(i<3?10:1)});if(n>bs){bs=n;best=p}});
    if(bs>=5)return best;
    const all=fold(String(res.all||res.head||"")).replace(/\s+/g," "),hits=BANKS.filter(b=>b[0].test(all));
    if(hits.length!==1)return"";
    const cand=(pms||[]).filter(p=>{const c=compact(p);return c.length>=2&&hits[0][1].some(t=>c===t||c.indexOf(t)===0||(t.length>=4&&c.indexOf(t)>-1))});
    return cand.length===1?cand[0]:""}

  /* ---------- turn parsed lines into review rows ---------- */
  const PAY=/ODEME|TESEKKUR|PAYMENT|ODEMENIZ|OTOMATIK ODEME|HESAPTAN|KART BORCU|KK ODEME/;
  const FEE_FAIZ=/FAIZ|BSMV|KKDF|GECIKME/,FEE_KOM=/UCRET|UCRETI|KOMISYON|MASRAF|AIDAT|UYELIK|YILLIK KART/;
  const REFUND=/\bIADE|\bIADESI|REFUND|IPTAL|\bIADE\b/,SALARY=/MAAS|SALARY|BORDRO|UCRET ODEMESI/;
  const XFER=/VIRMAN|KENDI HESAB|HESAPLAR ARASI|KREDI KARTI ODEME|KART ODEME|KK ODEME|KARTA ODEME/;
  const STOP={POS:1,ISTANBUL:1,TR:1,TRTR:1,TUR:1,AS:1,LTD:1,STI:1,SAN:1,TIC:1,VE:1,MAGAZA:1,MAGAZASI:1,AVM:1,ANKARA:1,IZMIR:1,ONLINE:1,WWW:1,COM:1,TL:1,THE:1,ODEME:1,YEMEKPAY:1,IYZICO:1,PAYTR:1,PARAM:1,SANAL:1,ECOM:1};
  const keyTok=s=>toks(s).filter(t=>t.length>=3&&!STOP[t]&&!/^\d+$/.test(t))[0]||"";

  function build(res,o){
    // o = {pm, credit, ctx:{rows, merchants, rules, transfers}, exp, inc, pms}
    const ctx=o.ctx||{},rules=(ctx.rules||[]).map(r=>({k:r.k,c:r.c,ck:compact(r.k)})).filter(r=>r.ck.length>=3);
    const hist=(ctx.merchants||[]).map(h=>({...h,ck:compact(h.n),tk:toks(h.n)})).filter(h=>h.ck.length>=3);
    const others=(o.pms||[]).filter(p=>p!==o.pm);
    let lines=res.rows.map(r=>({...r}));
    // sign: + = money out of the account (purchase / spend), - = money in
    lines.forEach(L=>{L.out=L.dir?L.dir*Math.abs(L.amt):(o.credit?L.amt:-L.amt)});
    if(o.credit&&!lines.some(L=>L.dir)){const pk=lines.filter(L=>PAY.test(fold(L.desc)));
      if((pk.length&&pk.every(L=>L.out>0)&&lines.some(L=>L.out<0))||(!pk.length&&lines.filter(L=>L.out<0).length>lines.length*.7))lines.forEach(L=>{L.out=-L.out})}
    const pickCat=(desc,kind)=>{const cd=compact(desc),dt=toks(desc);
      for(const r of rules)if(cd.indexOf(r.ck)>-1&&(kind==="inc"?o.inc:o.exp).indexOf(r.c)>-1)return{cat:r.c,src:"rule",why:r.k};
      let best=null,bs=0;
      hist.forEach(h=>{if(h.k!==kind)return;let s=0;
        if(h.ck.length>=6&&cd.indexOf(h.ck)>-1)s=100+h.ck.length;
        else if(h.ck.length>=3&&dt.some(t=>t===h.ck||(h.ck.length>=4&&t.indexOf(h.ck)===0)))s=90+h.ck.length;
        else if(h.ck.length>=5&&h.ck.length<6&&cd.indexOf(h.ck)>-1)s=60+h.ck.length;
        else{const t0=h.tk.filter(t=>t.length>=5&&!STOP[t])[0];if(t0&&dt.some(t=>t===t0||t.indexOf(t0)===0||(t.length>=5&&!STOP[t]&&t0.indexOf(t)===0)))s=50+t0.length}
        if(!s)return;s+=Math.min(h.cnt||1,10)*.3;if(s>bs||(s===bs&&best&&(h.t||"")>(best.t||""))){bs=s;best=h}});
      return best?{cat:best.c,src:"history",why:best.n}:null};
    const acctIn=desc=>{const cd=compact(desc);return others.filter(p=>compact(p).length>=3&&cd.indexOf(compact(p))>-1)[0]||""};
    const tf=ctx.transfers||{},topOf=m=>Object.keys(m||{}).sort((a,b)=>m[b]-m[a]).filter(a=>others.indexOf(a)>-1)[0];
    const fromAcct=topOf(tf.into)||others[0]||"",toAcct=topOf(tf.out)||others[0]||"";
    const has=(list,c)=>list.indexOf(c)>-1;
    const fallback=kind=>kind==="inc"?(has(o.inc,o.fallbackInc)?o.fallbackInc:o.inc[o.inc.length-1]||""):(has(o.exp,o.fallbackExp)?o.fallbackExp:o.exp[o.exp.length-1]||"");
    const clean=s=>String(s).replace(/\s+(TRTR|TR|TUR)$/,"").replace(/\s+[-–]$/,"").replace(/\s{2,}/g," ").trim()||"(no description)";
    const rows=lines.map((L,i)=>{const f=fold(L.desc),r={id:"L"+(i+1),d:L.d,d0:L.d0||"",n:clean(L.desc),raw:L.desc,a:r2(Math.abs(L.out)),dirOut:L.out>0,inst:L.inst,card:L.card,cat:"",acct:"",kind:"",src:"none",why:"",dup:null,link:null,sug:null,cari:"",desc:"",rl:false,rd:"",removed:false,inc:false,key:keyTok(L.desc)};
      if(L.out>0){
        const ac=acctIn(L.desc);
        if(!o.credit&&ac&&(XFER.test(f)||PAY.test(f)||ac)){r.kind="tr";r.acct=ac;r.src="rule";r.why="transfer"}
        else if(FEE_FAIZ.test(f)&&has(o.exp,o.interestCat)){r.kind="exp";r.cat=o.interestCat;r.src="rule";r.why="bank fee"}
        else if(FEE_KOM.test(f)&&has(o.exp,o.feeCat)){r.kind="exp";r.cat=o.feeCat;r.src="rule";r.why="bank fee"}
        else{r.kind="exp";const g=pickCat(L.desc,"exp");if(g){r.cat=g.cat;r.src=g.src;r.why=g.why}else r.cat=fallback("exp")}}
      else{
        const ac=acctIn(L.desc);
        if(o.credit&&(PAY.test(f)||ac)){r.kind="tr";r.acct=ac||fromAcct;r.src="rule";r.why="card payment"}
        else if(!o.credit&&(ac||XFER.test(f))){r.kind="tr";r.acct=ac||toAcct;r.src="rule";r.why="transfer"}
        else if(o.credit||REFUND.test(f)){r.kind="ret";const g=pickCat(L.desc,"exp");if(g){r.cat=g.cat;r.src=g.src;r.why=g.why}else r.cat=fallback("exp")}
        else{r.kind="inc";const g=pickCat(L.desc,"inc"),sal=SALARY.test(f)&&o.inc.find(c=>/^maa/i.test(fold(c)));if(g){r.cat=g.cat;r.src=g.src;r.why=g.why}else if(sal){r.cat=sal;r.src="rule";r.why="salary"}else r.cat=fallback("inc")}}
      if(r.kind==="tr"&&!r.acct){r.kind=L.out>0?"exp":(o.credit?"ret":"inc");r.cat=fallback(r.kind==="inc"?"inc":"exp");r.src="none"}
      return r});
    // already in Diligence? same account, amount within 0.05, transaction date within 3 days (instalment k = purchase date + k-1 months)
    const mv=(ctx.rows||[]).map(x=>({...x,m:o.credit?x.f:-x.f,used:false}));
    rows.forEach(r=>{const out=r.dirOut?r.a:-r.a,dd=r.inst&&r.inst.no>1?addMonthsYmd(r.d,r.inst.no-1):r.d;
      let best=null,bs=1e9;
      const rc=compact(r.raw),rk=r.key;
      mv.forEach(x=>{if(x.used)return;const da=Math.abs(x.m-out),dy=Math.abs(dayDiff(x.d,dd));if(da<=.05&&dy<=3){const xc=compact(x.pos+" "+x.desc),nm=(rk&&xc.indexOf(rk)>-1)||(compact(x.pos).length>=3&&rc.indexOf(compact(x.pos))>-1);const s=da*100+dy-(nm?5:0);if(s<bs){bs=s;best=x}}});
      if(!best&&r.inst)mv.forEach(x=>{if(x.used)return;const da=Math.abs(x.m-out*r.inst.of),dy=Math.abs(dayDiff(x.d,r.d));if(da<=1&&dy<=3&&!best)best=x});
      if(best){best.used=true;r.dup={id:best.id,n:best.pos||best.c1||"",d:best.d,a:r2(Math.abs(best.m))}}});
    // refunds: suggest the purchase they belong to
    const purch=rows.filter(x=>x.kind==="exp").map(x=>({src:"imp",id:x.id,n:x.n,d:x.d,a:x.a,key:x.key,cat:x.cat}))
      .concat((()=>{const g={};(ctx.rows||[]).filter(x=>(o.credit?x.f:-x.f)>0&&x.c1&&o.exp.indexOf(x.c1)>-1).forEach(x=>{const p=g[x.id];
        if(!p)g[x.id]={src:"mv",id:x.id,n:x.pos,d:x.d,a:Math.abs(x.f),key:keyTok(x.pos),cat:x.c1,k:1};else{p.a+=Math.abs(x.f);p.k++;if(x.d<p.d)p.d=x.d}});
        return Object.keys(g).map(k=>({...g[k],a:r2(g[k].a)}))})());
    rows.forEach(r=>{if(r.kind!=="ret"||r.dup||!r.key)return;
      const c=purch.filter(p=>p.key&&(p.key===r.key||p.key.indexOf(r.key)===0||r.key.indexOf(p.key)===0)&&p.a>=r.a-.01&&p.d<=r.d).sort((a,b)=>b.d<a.d?-1:1)[0];
      if(c)r.sug={type:"refund",to:c}});
    return{rows,purch}}

  // lines the user kept -> mass_save items
  function payload(rows,pm){
    return rows.filter(r=>!r.removed&&(!r.dup||r.inc)).map(r=>{
      const base={key:r.id,label:r.n,date:r.d,pm,amount:r.a,pos:r.n,desc:r.desc||""};
      if(r.kind==="tr")return{...base,type:"transfer",from:r.dirOut?pm:r.acct,to:r.dirOut?r.acct:pm,desc:r.desc||r.n};
      const it={...base,type:r.kind==="ret"?"return":r.kind==="inc"?"income":"expense",cat:r.cat,cari:r.cari||"",rec:r.rl&&r.rd?r.rd:(r.inst&&r.inst.no>1&&r.d0?r.d0:"")};
      if(r.link)it.link=r.link.to.src==="imp"?{imp:r.link.to.id}:{mv:r.link.to.id};
      else if(r.inst&&it.type==="expense")it.inst={no:r.inst.no,of:r.inst.of};
      return it})}
  return{read,build,payload,detectPm,parseDate,parseAmt,compact,fold,keyTok,addMonthsYmd,inferTurkish,tableRows,_pdfLines:pdfLines,_readPdf:readPdf,_readSheet:readSheet}
})();
