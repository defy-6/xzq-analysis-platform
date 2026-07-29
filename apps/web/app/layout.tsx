import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"厦漳泉都市圈综合分析平台",description:"厦门、漳州、泉州区域联系网络及后续用地、交通可达性与公共服务专题的一体化分析平台"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
