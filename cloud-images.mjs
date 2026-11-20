import {referencedImages,base64,unbase64} from './attachments.mjs?v=2.7';

// Firestore 单文档限制内分片存放原图；正文修订仍只携带图片索引。
const chunkSize=300000;
export async function downloadCloudImages(revisions,images,cloud){
  for(const meta of referencedImages(revisions)){
    try{await images.get(meta);continue;}catch{}
    if(cloud.state){const state=await cloud.state(meta.id);if(['archived','deleting'].includes(state?.state)){await images.markArchived?.(meta,state);continue;}}
    const total=Math.ceil(meta.size/chunkSize),bytes=new Uint8Array(meta.size);
    for(let index=0;index<total;index++){
      const part=await cloud.read(meta.id+'-'+index);
      if(!part||part.hash!==meta.id||part.index!==index||part.total!==total)throw Error('题目图片尚未上传完整：'+meta.name);
      const data=unbase64(part.data),expected=Math.min(chunkSize,meta.size-index*chunkSize);
      if(data.length!==expected)throw Error('题目图片分片损坏');bytes.set(data,index*chunkSize);
    }
    await images.put(meta,bytes);
  }
}
export async function uploadCloudImages(revisions,images,cloud){
  for(const meta of referencedImages(revisions)){
    if(cloud.state){const state=await cloud.state(meta.id);if(['archived','deleting'].includes(state?.state))continue;}
    const bytes=await images.get(meta),total=Math.ceil(bytes.length/chunkSize);
    for(let index=0;index<total;index++)await cloud.write(meta.id+'-'+index,{hash:meta.id,index,total,data:base64(bytes.subarray(index*chunkSize,(index+1)*chunkSize))});
  }
}
