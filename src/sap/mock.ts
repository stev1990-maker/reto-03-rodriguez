import { mkdir, readFile, appendFile } from "node:fs/promises"; import path from "node:path"; import type { OrdenCompra } from "../types.js"; import type { SapAdapter } from "./adapter.js";
type Prov={codigo_sap:string;nit:string;activo:boolean}; type Row={numero_oc:string;fecha:string;orden:OrdenCompra};
export class SapMock implements SapAdapter { constructor(private root:string){} private get file(){return path.join(this.root,"out/sap/ordenes.jsonl")}
 async rows():Promise<Row[]>{try{return (await readFile(this.file,"utf8")).trim().split("\n").filter(Boolean).map(x=>JSON.parse(x) as Row)}catch{return []}}
 async consultarProveedor(nit:string){const p=JSON.parse(await readFile(path.join(this.root,"fixtures/reto-03/maestros/proveedores.json"),"utf8")) as Prov[]; const x=p.find(v=>v.nit===nit);return x?{codigo_sap:x.codigo_sap,activo:x.activo}:null}
 async buscarOrdenPorReferencia(id:string){const r=(await this.rows()).find(x=>x.orden.referencia.solicitud_id===id);return r?{numero_oc:r.numero_oc}:null}
 async crearOrden(orden:OrdenCompra){const old=await this.buscarOrdenPorReferencia(orden.referencia.solicitud_id);if(old){const row=(await this.rows()).find(x=>x.numero_oc===old.numero_oc)!;return {numero_oc:old.numero_oc,fecha:row.fecha}} const rows=await this.rows();const numero_oc=String(4500000001+rows.length);const fecha=new Date().toISOString();await mkdir(path.dirname(this.file),{recursive:true});await appendFile(this.file,JSON.stringify({numero_oc,fecha,orden})+"\n");return {numero_oc,fecha}}
}
