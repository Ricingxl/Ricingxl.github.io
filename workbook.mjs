// 固定表格的离线XLSX读写。只读取数值与文本，不执行公式、宏或外部链接。
const encoder=new TextEncoder(), decoder=new TextDecoder('utf-8');
const xml=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export const crc32=bytes=>{let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;};
const column=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
export function zip(entries) {
  const parts=[],central=[];let offset=0;
  for(const [path,text] of Object.entries(entries)) {
    const name=encoder.encode(path),data=text instanceof Uint8Array?text:encoder.encode(text),crc=crc32(data);
    const local=new Uint8Array(30+name.length),v=new DataView(local.buffer);
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,2048,true);v.setUint16(12,33,true);
    v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);local.set(name,30);
    const c=new Uint8Array(46+name.length),cv=new DataView(c.buffer);
    cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,2048,true);cv.setUint16(14,33,true);
    cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);c.set(name,46);
    parts.push(local,data);central.push(c);offset+=local.length+data.length;
  }
  const size=central.reduce((n,b)=>n+b.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);
  v.setUint32(0,0x06054b50,true);v.setUint16(8,central.length,true);v.setUint16(10,central.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);
  const output=new Uint8Array(offset+size+22);let at=0;for(const p of [...parts,...central,end]){output.set(p,at);at+=p.length;}return output;
}
export function writeXlsx(tables) {
  const entries={},names=Object.keys(tables);
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  entries['_rels/.rels']='<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  entries['xl/workbook.xml']=`<?xml version="1.0"?><workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n,i)=>`<sheet name="${xml(n)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`;
  entries['xl/_rels/workbook.xml.rels']=`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  entries['xl/styles.xml']=`<?xml version="1.0"?><styleSheet xmlns="${ns}"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="[h]:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173B61"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  names.forEach((name,i)=>{
    const rows=tables[name],headers=rows[0]||[];
    const content=rows.map((row,r)=>`<row r="${r+1}" ht="${r?36:32}" customHeight="1">${row.map((value,c)=>{
      let style=r?0:1,v=value;
      if(r && ['日期','学习日期'].includes(headers[c]) && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {v=(Date.parse(value+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000;style=2;}
      if(r && ['开始时间','结束时间'].includes(headers[c]) && /^\d{2}:\d{2}$/.test(String(value))) {v=(Number(value.slice(0,2))*60+Number(value.slice(3,5)))/1440;style=3;}
      return typeof v==='number' && Number.isFinite(v)?`<c r="${column(c)}${r+1}" s="${style}"><v>${v}</v></c>`:`<c r="${column(c)}${r+1}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const cols=headers.map((header,c)=>`<col min="${c+1}" max="${c+1}" width="${/内容|反馈|卡点|题目|调整/.test(header)?55:/ID/.test(header)?24:18}" customWidth="1"/>`).join('');
    entries[`xl/worksheets/sheet${i+1}.xml`]=`<?xml version="1.0"?><worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${content}</sheetData><autoFilter ref="A1:${column(Math.max(0,headers.length-1))}${Math.max(1,rows.length)}"/></worksheet>`;
  });
  entries['[Content_Types].xml']=`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  return zip(entries);
}
export async function unzip(input, binary = false) {
  const bytes=new Uint8Array(input),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length>(binary?128:8)*1024*1024)throw Error(binary?'数据包超过128MB':'表格超过8MB，请分批上传');
  let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw Error('不是有效的XLSX文件');
  const count=v.getUint16(end+10,true);let offset=v.getUint32(end+16,true),total=0;
  if(count>(binary?5000:200))throw Error('文件条目过多');
  const output=Object.create(null),seen=new Set();
  for(let i=0;i<count;i++) {
    if(v.getUint32(offset,true)!==0x02014b50)throw Error('XLSX目录损坏');
    const flags=v.getUint16(offset+8,true),method=v.getUint16(offset+10,true),crc=v.getUint32(offset+16,true),compressed=v.getUint32(offset+20,true),size=v.getUint32(offset+24,true);
    const length=v.getUint16(offset+28,true),extra=v.getUint16(offset+30,true),comment=v.getUint16(offset+32,true),local=v.getUint32(offset+42,true);
    const name=decoder.decode(bytes.slice(offset+46,offset+46+length));offset+=46+length+extra+comment;total+=size;
    if(flags&1||size>(binary?128:10)*1024*1024||total>(binary?256:24)*1024*1024)throw Error('文件加密或解压数据过大');
    if(!name||name.includes('\\')||name.includes(':')||name.includes('\0')||name.split('/').some(p=>p==='..'||p==='.'||p===''))throw Error('文件路径无效');
    if(seen.has(name))throw Error('文件包含重复条目');seen.add(name);
    if(!binary&&name.endsWith('.bin'))throw Error('请使用不含宏的.xlsx文件');
    if(!binary&&!name.endsWith('.xml')&&!name.endsWith('.rels'))continue;
    if(v.getUint32(local,true)!==0x04034b50)throw Error('XLSX文件损坏');
    const start=local+30+v.getUint16(local+26,true)+v.getUint16(local+28,true);
    if(start+compressed>bytes.length)throw Error('压缩数据不完整');
    let result=bytes.slice(start,start+compressed);
    if(method===8) {
      let decompressor;try{decompressor=new DecompressionStream('deflate-raw');}catch{throw Error('此浏览器无法解压XLSX，请换用新版Chrome/Edge或导出CSV再上传');}
      const reader=new Blob([result]).stream().pipeThrough(decompressor).getReader(),chunks=[];let consumed=0;
      for(;;){const part=await reader.read();if(part.done)break;consumed+=part.value.length;if(consumed>size){await reader.cancel();throw Error('解压大小校验失败');}chunks.push(part.value);}
      result=new Uint8Array(consumed);let at=0;for(const chunk of chunks){result.set(chunk,at);at+=chunk.length;}
    } else if(method!==0)throw Error('不支持此XLSX压缩格式');
    if(result.length!==size||crc32(result)!==crc)throw Error('XLSX完整性校验失败');
    if(Object.hasOwn(output,name))throw Error('XLSX包含重复文件条目');
    output[name]=binary?result:decoder.decode(result);
  }
  return output;
}
const elements=(node,name)=>[...node.getElementsByTagNameNS('*',name)];
function parseXml(text) {
  if(!text||/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('XML内容无效');
  const doc=new DOMParser().parseFromString(text,'application/xml');
  if(elements(doc,'parsererror').length)throw Error('XLSX内部XML格式错误');
  return doc;
}
export async function readXlsx(buffer) {
  const files=await unzip(buffer),book=parseXml(files['xl/workbook.xml']),rels=parseXml(files['xl/_rels/workbook.xml.rels']);
  if(elements(book,'workbookPr').some(n=>['1','true'].includes(n.getAttribute('date1904'))))throw Error('请将工作簿设置为1900日期系统或使用CSV');
  const relationships=new Map(elements(rels,'Relationship').filter(r=>r.getAttribute('TargetMode')!=='External').map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));
  const strings=files['xl/sharedStrings.xml']?elements(parseXml(files['xl/sharedStrings.xml']),'si').map(n=>elements(n,'t').map(t=>t.textContent).join('')):[];
  const tables=Object.create(null);
  for(const sheet of elements(book,'sheet')) {
    const name=sheet.getAttribute('name'),id=sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
    if(Object.hasOwn(tables,name))throw Error('工作表名称重复');
    let target=relationships.get(id);if(!target)throw Error('工作表关系不完整');
    target=target.startsWith('/')?target.slice(1):'xl/'+target;
    if(target.includes('..')||!target.startsWith('xl/'))throw Error('工作表路径不正确');
    const doc=parseXml(files[target]),rows=[],seenRows=new Set();
    for(const row of elements(doc,'row')) {
      const rowNumber=Number(row.getAttribute('r'));
      if(!Number.isInteger(rowNumber)||rowNumber<1||rowNumber>5001||seenRows.has(rowNumber))throw Error('工作表行号重复、无效或超过5000条记录');
      seenRows.add(rowNumber);
      const values=[];
      for(const cell of elements(row,'c')) {
        const address=cell.getAttribute('r'),letters=/^([A-Z]+)\d+$/.exec(address)?.[1];if(!letters)throw Error('单元格地址无效');
        let c=0;for(const letter of letters)c=c*26+letter.charCodeAt(0)-64;c--;
        if(c>30||values[c]!==undefined||Number(address.slice(letters.length))!==rowNumber)throw Error('单元格重复或超出固定模板范围');
        if(elements(cell,'f').length)throw Error('上传表格不能包含公式，请粘贴为数值后上传');
        const type=cell.getAttribute('t'),raw=elements(cell,'v')[0]?.textContent||'';
        let value=type==='inlineStr'?elements(cell,'t').map(n=>n.textContent).join(''):type==='s'?strings[Number(raw)]:type==='d'?raw.slice(0,10):type==='str'?raw:raw===''?'':Number(raw);
        if(value===undefined||typeof value==='number'&&!Number.isFinite(value)||String(value).length>30000)throw Error('单元格数据无效');
        values[c]=value;
      }
      for(let i=0;i<values.length;i++)if(values[i]===undefined)values[i]='';
      rows[rowNumber-1]=values;
    }
    for(let i=0;i<rows.length;i++)if(!rows[i])rows[i]=[];
    tables[name]=rows;
  }
  return tables;
}
