import fs from "node:fs/promises";
import path from "node:path";

const project=path.resolve(import.meta.dirname,"../..");
const platform=path.resolve(project,"../..");
const sourceFile=path.join(project,"public/data/township-relations.json");
const publicFile=path.join(project,"public/data/township-secondary-industry.json");
const externalDir=path.join(platform,"data/processed/contact-network/exports");
await fs.mkdir(externalDir,{recursive:true});
const externalFile=path.join(externalDir,"镇街二级行业OD_跨区县.json");
const csvFile=path.join(externalDir,"厦漳泉跨区县镇街二级行业OD明细.csv");
const source=JSON.parse(await fs.readFile(sourceFile,"utf8"));
const relationOrder={"投资":1,"分支":2,"专利":3};
const compare=(a,b)=>String(a).localeCompare(String(b),"zh-CN");
const district=(city,county)=>`${city}|${county}`;
const pairParts=(record)=>{
  const a={city:record[4],county:record[5]},b={city:record[7],county:record[8]};
  return compare(district(a.city,a.county),district(b.city,b.county))<=0?[a,b]:[b,a];
};
const records=source.records.filter(record=>record[1]===2&&record[2]&&district(record[4],record[5])!==district(record[7],record[8])).map(record=>{
  const [left,right]=pairParts(record);
  return {
    districtPair:`${left.city}|${left.county}↔${right.city}|${right.county}`,
    leftCity:left.city,leftCounty:left.county,rightCity:right.city,rightCounty:right.county,
    relation:record[0],direction:record[0]==="专利"?"无向":"有向",
    industryCode:record[2],industryName:record[3],
    oCity:record[4],oCounty:record[5],oTown:record[6],dCity:record[7],dCounty:record[8],dTown:record[9],
    count:record[10],amount:record[11],amountCount:record[12],uniquePatents:record[13],enterprisePairs:record[14],maxPairPatents:record[15],maxPairShare:record[16],unmatched:record[17]
  };
});
records.sort((a,b)=>compare(a.districtPair,b.districtPair)||(relationOrder[a.relation]-relationOrder[b.relation])||compare(a.industryCode,b.industryCode)||compare(`${a.oCity}${a.oCounty}${a.oTown}`,`${b.oCity}${b.oCounty}${b.oTown}`)||compare(`${a.dCity}${a.dCounty}${a.dTown}`,`${b.dCity}${b.dCounty}${b.dTown}`));

const summaries=new Map();
const directories=new Map();
for(const record of records){
  const summaryKey=[record.districtPair,record.relation,record.industryCode].join("|");
  const summary=summaries.get(summaryKey)||{districtPair:record.districtPair,leftCity:record.leftCity,leftCounty:record.leftCounty,rightCity:record.rightCity,rightCounty:record.rightCounty,relation:record.relation,direction:record.direction,industryCode:record.industryCode,industryName:record.industryName,townOdCount:0,oTowns:new Set(),dTowns:new Set(),count:0,amount:0,amountCount:0,uniquePatents:0,enterprisePairs:0,unmatched:0};
  summary.townOdCount+=1;summary.oTowns.add(`${record.oCity}|${record.oCounty}|${record.oTown}`);summary.dTowns.add(`${record.dCity}|${record.dCounty}|${record.dTown}`);summary.count+=record.count;summary.amount+=record.amount;summary.amountCount+=record.amountCount;summary.uniquePatents+=record.uniquePatents;summary.enterprisePairs+=record.enterprisePairs;summary.unmatched+=record.unmatched;summaries.set(summaryKey,summary);
  const directory=directories.get(record.districtPair)||{districtPair:record.districtPair,leftCity:record.leftCity,leftCounty:record.leftCounty,rightCity:record.rightCity,rightCounty:record.rightCounty,townIndustryOdCount:0,industries:new Set(),relations:new Set(),count:0,amount:0};
  directory.townIndustryOdCount+=1;directory.industries.add(record.industryCode);directory.relations.add(record.relation);directory.count+=record.count;directory.amount+=record.amount;directories.set(record.districtPair,directory);
}
const summaryRecords=[...summaries.values()].map(item=>({...item,oTownCount:item.oTowns.size,dTownCount:item.dTowns.size,oTowns:undefined,dTowns:undefined})).sort((a,b)=>compare(a.districtPair,b.districtPair)||(relationOrder[a.relation]-relationOrder[b.relation])||compare(a.industryCode,b.industryCode));
const directoryRecords=[...directories.values()].map(item=>({...item,industryCount:item.industries.size,relationTypes:[...item.relations].sort((a,b)=>relationOrder[a]-relationOrder[b]).join("、"),industries:undefined,relations:undefined})).sort((a,b)=>compare(a.districtPair,b.districtPair));
const payload={
  meta:{
    generatedAt:new Date().toISOString(),source:sourceFile,scope:"厦漳泉跨区县镇街二级行业OD",amountUnit:"万元人民币",
    rules:["仅保留industryLevel=2且二级行业代码有效的记录","O/D区县必须不同","O/D镇街均完整且不同","投资、分支为有向关系","专利按专利名＋无序企业对去重并作为无向关系","投资与分支行业为D端二级行业；专利行业为任一企业端相关行业"],
    fields:Object.keys(records[0]||{}),directoryRecords:directoryRecords.length,summaryRecords:summaryRecords.length,detailRecords:records.length
  },
  districtPairs:directoryRecords,countyPairIndustry:summaryRecords,records
};
await fs.writeFile(publicFile,JSON.stringify(payload,null,0));
await fs.writeFile(externalFile,JSON.stringify(payload,null,0));
const csvHeaders=["区县对","关系类型","方向属性","二级行业代码","二级行业名称","O端地市","O端区县","O端镇街","D端地市","D端区县","D端镇街","关系数量","金额（万元）","有金额记录数","唯一专利名","企业对数","最大企业对专利数","最大企业对贡献率","方向不匹配数"];
const csvValue=value=>{const text=String(value??"");return /[",\n\r]/.test(text)?`"${text.replaceAll('"','""')}"`:text};
const csvRows=records.map(x=>[x.districtPair,x.relation,x.direction,x.industryCode,x.industryName,x.oCity,x.oCounty,x.oTown,x.dCity,x.dCounty,x.dTown,x.count,x.amount,x.amountCount,x.uniquePatents,x.enterprisePairs,x.maxPairPatents,x.maxPairShare,x.unmatched].map(csvValue).join(","));
await fs.writeFile(csvFile,"\ufeff"+[csvHeaders.map(csvValue).join(","),...csvRows].join("\n"));
console.log(JSON.stringify({publicFile,externalFile,csvFile,...payload.meta},null,2));
