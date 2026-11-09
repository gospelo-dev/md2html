// subset-font ships no type declarations.
declare module 'subset-font' {
  interface SubsetOptions {
    targetFormat?: 'sfnt' | 'woff' | 'woff2' | 'truetype'
    preserveNameIds?: number[]
    keepFeatures?: string[]
    noLayoutClosure?: boolean
    glyphNames?: boolean
    noHinting?: boolean
    dropTables?: string[]
    keepAllGlyphs?: boolean
  }
  export default function subsetFont(font: Buffer, text: string, options?: SubsetOptions): Promise<Buffer>
}
