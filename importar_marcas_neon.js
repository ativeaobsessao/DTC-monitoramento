/**
 * importar_marcas_neon.js
 * Script de importação em lote das 57 marcas do arquivo CSV para o banco NEON.
 * 
 * Uso via terminal:
 *   node importar_marcas_neon.js
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("❌ ERRO: A variável de ambiente DATABASE_URL não foi encontrada!");
  console.error("Certifique-se de definir DATABASE_URL no terminal antes de rodar o script.");
  console.error("Exemplo PowerShell: $env:DATABASE_URL=\"postgres://...\"; node importar_marcas_neon.js");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
});

function toSlug(str) {
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function importar() {
  console.log("🚀 Iniciando importação do arquivo CSV para o NEON...");
  const csvPath = path.join(__dirname, "DTC USA BRANDS • SWIPE FILE - Marcas.csv");
  
  if (!fs.existsSync(csvPath)) {
    console.error("❌ ERRO: Arquivo CSV não encontrado no caminho:", csvPath);
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, "utf8");
  const lines = content.split(/\r?\n/);
  
  let salvosPaginas = 0;
  let salvosDominios = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("👉") || line.startsWith(",,,,") || line.startsWith("CATEGORY,")) continue;
    
    // Parser seguro para colunas com e sem aspas
    const cols = [];
    let cur = "";
    let inQuotes = false;
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        cols.push(cur.trim());
        cur = "";
      } else {
        cur += char;
      }
    }
    cols.push(cur.trim());

    const category = cols[0] || "";
    const subcategory = cols[1] || "";
    const brand = cols[2] || "";
    const site = cols[3] || "";
    const biblioteca = cols[4] || "";

    if (!brand || !biblioteca) continue;

    const nicho = subcategory ? `${category} — ${subcategory}` : category;

    // 1. Salvar a BIBLIOTECA (tipo = 'pagina')
    const slugPag = toSlug(brand + "-lib");
    if (slugPag) {
      await query(
        `INSERT INTO pages (slug, nome, url, tipo, instagram_url, geo, nicho, funil, brand)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (slug) DO UPDATE
           SET nome=$2, url=$3, tipo=$4,
               nicho=COALESCE(EXCLUDED.nicho, pages.nicho),
               brand=COALESCE(EXCLUDED.brand, pages.brand)`,
        [slugPag, brand, biblioteca, "pagina", null, "US", nicho || null, null, brand]
      );
      salvosPaginas++;
      console.log(`  📡 [PÁGINA] Salvo: ${brand} (${slugPag})`);
    }

    // 2. Salvar o SITE oficial (tipo = 'dominio') se houver URL válida
    if (site && site.startsWith("http")) {
      const slugDom = toSlug(brand + "-site");
      if (slugDom) {
        await query(
          `INSERT INTO pages (slug, nome, url, tipo, instagram_url, geo, nicho, funil, brand)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (slug) DO UPDATE
             SET nome=$2, url=$3, tipo=$4,
                 nicho=COALESCE(EXCLUDED.nicho, pages.nicho),
                 brand=COALESCE(EXCLUDED.brand, pages.brand)`,
          [slugDom, brand + " (Site)", site, "dominio", null, "US", nicho || null, null, brand]
        );
        salvosDominios++;
        console.log(`  🌐 [DOMÍNIO] Salvo: ${brand} (${slugDom})`);
      }
    }

    // 3. Salvar também no catálogo geral brands
    await query(
      `INSERT INTO brands (nome, site) VALUES ($1, $2) ON CONFLICT (nome) DO UPDATE SET site=EXCLUDED.site`,
      [brand, site || null]
    ).catch(() => {});
  }

  console.log("\n🎉 IMPORTAÇÃO CONCLUÍDA COM SUCESSO!");
  console.log(`📡 Total de Bibliotecas (tipo 'pagina') salvas: ${salvosPaginas}`);
  console.log(`🌐 Total de Domínios (tipo 'dominio') salvos: ${salvosDominios}`);
  console.log("\n💡 Agora você pode rodar '/api/coletar-tudo' para fazer a fotografia inicial ou aguardar o CRON rodar!");
  await pool.end();
}

importar().catch(err => {
  console.error("❌ Erro fatal na importação:", err);
  process.exit(1);
});
