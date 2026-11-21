/**
 * Planner de treino: backup no seu Google Drive (gratuito, roda na sua própria conta Google).
 * Guarda na pasta "Planner de treino" do seu Drive:
 *   - planner-treino-backup.json: o backup completo (o mesmo formato de "Exportar backup", dá para importar no app);
 *   - a planilha "Planner de treino - banco de dados": a aba Exercícios e uma aba para cada exercício com registros;
 *   - a pasta "Cópias": como o backup estava no início de cada dia (120 dias) e antes de outro aparelho substituí-lo.
 *
 * Como publicar (uma vez só, uns 5 minutos, no computador):
 *   1. Abra https://script.google.com e clique em "Novo projeto".
 *   2. Apague o que estiver no editor, cole TODO este arquivo e salve (ícone de disquete). Dê o nome "Planner de treino".
 *   3. Clique em "Implantar" → "Nova implantação". Na engrenagem ao lado de "Selecionar tipo", escolha "App da Web".
 *   4. Em "Executar como", deixe "Eu". Em "Quem pode acessar", escolha "Qualquer pessoa".
 *   5. Clique em "Implantar". O Google pede autorização: escolha sua conta e marque TODAS as caixinhas
 *      ("Selecionar tudo"), inclusive Google Drive e Planilhas. Se aparecer "O Google não verificou este app",
 *      clique em "Avançado" → "Acessar Planner de treino (não seguro)": o app é este script, seu, na sua conta.
 *   6. Copie a "URL do app da Web" (termina em /exec).
 *   7. No app: Ajustes → Backup no Google Drive → cole o endereço → Conectar.
 *   Nos outros aparelhos, use o link de "Conectar outro aparelho" (Ajustes, no aparelho já conectado).
 *
 * Atualizar o código depois: cole o código novo, salve e vá em "Implantar" → "Gerenciar implantações" → lápis →
 * "Versão: Nova versão" → "Implantar". Assim o endereço continua o mesmo.
 *
 * Se o app mostrar erro de permissão do Drive ou das Planilhas (alguma caixinha ficou desmarcada): aqui no editor,
 * escolha a função "autorizar" no menu ao lado de "Depuração", clique em "Executar" e marque todas as permissões.
 *
 * Segurança: o primeiro aparelho que conecta registra uma chave secreta; sem ela ninguém lê nem grava o backup,
 * mesmo tendo o endereço. Se perder o aparelho, rode aqui a função "redefinirChave" e conecte o aparelho novo:
 * o backup continua no Drive e pode ser restaurado.
 */
const NOME_PASTA = 'Planner de treino';
const NOME_ARQUIVO = 'planner-treino-backup.json';
const NOME_PLANILHA = 'Planner de treino - banco de dados';
const DIAS_GUARDADOS = 120;   // cópias do início de cada dia
const OUTRAS_GUARDADAS = 40;  // cópias de antes de outro aparelho substituir o backup

function doGet() {
  return json_({ ok: true, servico: 'planner-treino' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ erro: 'Pedido inválido.' }); }
  if (!req || typeof req.chave !== 'string' || req.chave.length < 24) return json_({ erro: 'Pedido sem chave.' });

  const props = PropertiesService.getScriptProperties();
  // A chave é conferida antes da trava: um pedido com chave errada não segura os pedidos do aparelho certo
  if (req.acao !== 'registrar') {
    const chave = props.getProperty('CHAVE');
    if (!chave) return json_({ erro: 'Este script ainda não foi conectado. No app, use Ajustes → Backup no Google Drive → Conectar.' });
    if (chave !== req.chave) { Utilities.sleep(1000); return json_({ erro: 'Chave inválida. Conecte este aparelho de novo.' }); }
  }
  // A planilha pode levar minutos na primeira vez e não mexe no backup: roda sem a trava, para não atrasar os backups
  if (req.acao === 'planilha') {
    try {
      const faltando = atualizarPlanilha_(req.planilha);
      props.setProperty('PLANILHA_DE', String(req.aparelhoId || '').slice(0, 40)); // quem escreveu a planilha por último
      const r = info_(props);
      r.faltando = faltando;
      return json_(r);
    } catch (err) {
      return json_({ erro: 'Erro no script: ' + err });
    }
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return json_({ erro: 'O Drive está ocupado. Tente de novo em instantes.' });
  try {
    switch (req.acao) {
      case 'registrar': {
        const chave = props.getProperty('CHAVE');
        if (chave && chave !== req.chave) {
          return json_({ erro: 'Este script já está ligado a outro aparelho. No aparelho conectado, use "Conectar outro aparelho" ' +
                               '(Ajustes → Backup no Google Drive) e abra o link aqui. Se perdeu aquele aparelho, rode a função ' +
                               '"redefinirChave" no editor do script.' });
        }
        if (!chave) props.setProperty('CHAVE', req.chave);
        return json_(info_(props));
      }
      case 'info': return json_(info_(props));
      case 'baixar': {
        const r = info_(props), atual = lerAtual_();
        r.backup = atual ? JSON.parse(atual) : null;
        return json_(r);
      }
      case 'enviar': return json_(enviar_(req, props));
    }
    return json_({ erro: 'Ação desconhecida: ' + req.acao });
  } catch (err) {
    return json_({ erro: 'Erro no script: ' + err });
  } finally {
    lock.releaseLock();
  }
}

/* rode aqui no editor se o app mostrar erro de permissão: o Google pede de novo as permissões que faltam
   (marque todas, inclusive Google Drive e Planilhas) e cria a pasta e a planilha */
function autorizar() {
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  pastaCopias_();
  planilha_();
  Logger.log('Tudo certo: a pasta "' + NOME_PASTA + '" está no seu Drive. Volte ao app e toque em "Fazer backup agora".');
}

/* rode aqui no editor só se perder o aparelho conectado: o próximo aparelho que conectar registra uma chave nova */
function redefinirChave() {
  PropertiesService.getScriptProperties().deleteProperty('CHAVE');
  Logger.log('Chave apagada. Conecte o app de novo em Ajustes → Backup no Google Drive. O backup continua no Drive.');
}

function info_(props) {
  const p = props.getProperties();
  return {
    ok: true,
    conta: Session.getEffectiveUser().getEmail(),
    atualizado: p.ATUALIZADO || '',   // quando foi o último backup (é também a versão dele)
    aparelho: p.APARELHO || '',       // quem fez o último backup ("Celular", "Computador")
    planilhaDe: p.PLANILHA_DE || '',  // qual aparelho escreveu a planilha por último
    pasta: p.PASTA_URL || '',
    planilha: p.PLANILHA_URL || '',
  };
}

function enviar_(req, props) {
  const backup = req.backup;
  if (!backup || !backup.dados || !Array.isArray(backup.dados.treinos) || !Array.isArray(backup.dados.historico)) {
    return { erro: 'Os dados enviados não parecem do Planner de treino.' };
  }
  const aparelhoId = String(req.aparelhoId || '').slice(0, 40);
  const atual = props.getProperty('ATUALIZADO') || '', ultimo = props.getProperty('APARELHO_ID') || '';
  // Outro aparelho fez um backup que este ainda não viu: só substitui se a pessoa escolher isso no app
  if (atual && req.versao !== atual && ultimo !== aparelhoId && !req.substituir) {
    const r = info_(props);
    r.conflito = true;
    return r;
  }
  const texto = JSON.stringify(backup), arquivo = guardado_('ARQUIVO', false);
  if (arquivo) {
    // Antes de trocar, guarda cópias de como estava: no início de cada dia e quando outro aparelho substitui
    const dia = hoje_('yyyy-MM-dd');
    if (props.getProperty('DIA') !== dia) {
      guardarCopia_(arquivo, dia, /^\d{4}-\d{2}-\d{2}\.json$/, DIAS_GUARDADOS);
      props.setProperty('DIA', dia);
    }
    if (ultimo && ultimo !== aparelhoId) {
      guardarCopia_(arquivo, hoje_('yyyy-MM-dd HH-mm') + ' antes de trocar de aparelho', /^\d{4}-\d{2}-\d{2} \d{2}-\d{2} /, OUTRAS_GUARDADAS);
    }
    arquivo.setContent(texto);
  } else {
    props.setProperty('ARQUIVO', pasta_().createFile(NOME_ARQUIVO, texto, 'application/json').getId());
  }
  props.setProperties({ ATUALIZADO: new Date().toISOString(), APARELHO_ID: aparelhoId, APARELHO: String(req.aparelho || '').slice(0, 30) });
  return info_(props);
}

/* ---------------- arquivos no Drive ---------------- */
// Pasta ou arquivo guardado nas propriedades do script (null se foi apagado ou está na lixeira)
function guardado_(nome, pasta) {
  const id = PropertiesService.getScriptProperties().getProperty(nome);
  if (!id) return null;
  try {
    const x = pasta ? DriveApp.getFolderById(id) : DriveApp.getFileById(id);
    return x.isTrashed() ? null : x;
  } catch (e) { return null; }
}
// O guardado, ou um novo feito por criar() (o endereço fica guardado também, para o app abrir)
function garantir_(nome, pasta, criar) {
  const atual = guardado_(nome, pasta);
  if (atual) return atual;
  const novo = criar();
  const props = {};
  props[nome] = novo.getId();
  props[nome + '_URL'] = novo.getUrl();
  PropertiesService.getScriptProperties().setProperties(props);
  return novo;
}
function pasta_() { return garantir_('PASTA', true, function () { return DriveApp.createFolder(NOME_PASTA); }); }
function pastaCopias_() { return garantir_('COPIAS', true, function () { return pasta_().createFolder('Cópias'); }); }
function planilha_() {
  const arquivo = garantir_('PLANILHA', false, function () {
    const f = DriveApp.getFileById(SpreadsheetApp.create(NOME_PLANILHA).getId());
    f.moveTo(pasta_());
    return f;
  });
  return SpreadsheetApp.openById(arquivo.getId());
}
function lerAtual_() {
  const f = guardado_('ARQUIVO', false);
  return f ? f.getBlob().getDataAsString('UTF-8') : null;
}

function hoje_(formato) { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), formato); }
/* copia o backup para a pasta Cópias (sem baixar o conteúdo) e manda para a lixeira as mais antigas além do limite */
function guardarCopia_(arquivo, nome, padrao, manter) {
  const pasta = pastaCopias_();
  arquivo.makeCopy(nome + '.json', pasta);
  const copias = [], it = pasta.getFiles();
  while (it.hasNext()) { const f = it.next(); if (padrao.test(f.getName())) copias.push(f); }
  copias.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
  copias.slice(manter).forEach(function (f) { f.setTrashed(true); });
}

/* ---------------- planilha: aba Exercícios + uma aba por exercício ---------------- */
// p = { nomes: [todas as abas, a primeira é a dos exercícios], abas: [{ nome, colunas, linhas }] }, montado pelo app.
// O app só manda as abas que mudaram; as que não estão em "nomes" (exercícios renomeados ou juntados) saem.
// Devolve as abas de "nomes" que não existem na planilha (alguém apagou), para o app mandar de novo.
function atualizarPlanilha_(p) {
  if (!p || !Array.isArray(p.nomes) || !p.nomes.length || !Array.isArray(p.abas)) throw new Error('A planilha veio sem dados.');
  const ss = planilha_(), abas = {};
  ss.getSheets().forEach(function (f) { abas[f.getName().toLowerCase()] = f; });
  p.abas.forEach(function (aba) {
    const nome = nomeAba_(aba.nome), k = nome.toLowerCase(), folha = abas[k];
    if (folha && folha.getName() !== nome) folha.setName(nome); // só mudaram maiúsculas e minúsculas
    abas[k] = escreverAba_(ss, folha, nome, aba.colunas, aba.linhas);
  });
  const ficam = {};
  p.nomes.forEach(function (n) { ficam[nomeAba_(n).toLowerCase()] = true; });
  Object.keys(abas).forEach(function (k) {
    if (ficam[k] || ss.getNumSheets() < 2) return; // a planilha precisa ter pelo menos uma aba
    ss.deleteSheet(abas[k]);
    delete abas[k];
  });
  const indice = abas[nomeAba_(p.nomes[0]).toLowerCase()];
  if (indice && indice.getIndex() !== 1) { ss.setActiveSheet(indice); ss.moveActiveSheet(1); }
  return p.nomes.filter(function (n) { return !abas[nomeAba_(n).toLowerCase()]; });
}
function nomeAba_(n) { return String(n).slice(0, 99) || 'Aba'; }

function escreverAba_(ss, folha, nome, colunas, linhas) {
  const nova = !folha, largura = Math.max(1, colunas.length);
  const valores = [colunas].concat(linhas || []).map(function (l) {
    const linha = [];
    for (let i = 0; i < largura; i++) linha.push(celula_(l && l[i]));
    return linha;
  });
  if (nova) folha = ss.insertSheet(nome, ss.getNumSheets());
  else folha.clearContents();
  const maximo = folha.getMaxRows();
  if (valores.length > maximo) folha.insertRowsAfter(maximo, valores.length - maximo);
  folha.getRange(1, 1, valores.length, largura).setValues(valores);
  if (nova) {
    folha.setFrozenRows(1);
    folha.getRange('1:1').setFontWeight('bold');
    folha.autoResizeColumns(1, largura);
  }
  return folha;
}
// Números ficam números e datas (2026-11-20) viram datas; o resto entra como texto: o apóstrofo da frente
// não aparece na célula e impede que um nome vire fórmula (=...) ou data (1/2)
function celula_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return isFinite(v) ? v : '';
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "'" + s;
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
