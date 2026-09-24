import { formatDay } from '../utils/contentPipeline'

/**
 * The content calendar's words. The tab is always in Portuguese — the team
 * plans content in Portuguese, whatever language the rest of the app is set
 * to. The English is kept as the shape the Portuguese is checked against.
 *
 * Kept apart from translations.ts because most of them carry a number or a
 * date, and a flat list of strings with "{n}" in them cannot say "1 vídeo"
 * and "8 vídeos" — so here an entry can be a function. The Portuguese is
 * typed against the English, so a missing or mis-shaped one does not compile.
 */

type Stage = 'plan' | 'record' | 'edit' | 'deliver' | 'schedule' | 'post'

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/**
 * Close a sentence, unless it already ends in a stop. A Portuguese date does:
 * "6 de nov." — and a sentence ending on one otherwise read "6 de nov..".
 */
export const endSentence = (s: string) => (/[.…]$/.test(s) ? s : `${s}.`)

const en = {
  // ─── Stages ───────────────────────────────────────────────────────────────
  stage: {
    plan: 'Content plan',
    record: 'Recording',
    edit: 'Editing',
    deliver: 'Delivery',
    schedule: 'Scheduling',
    post: 'Posting',
  } as Record<Stage, string>,
  /** How a task starts when it is written as an instruction: "Record ESP". */
  verb: {
    plan: 'Plan',
    record: 'Record',
    edit: 'Edit',
    deliver: 'Deliver',
    schedule: 'Schedule',
    post: 'Post',
  } as Record<Stage, string>,
  /** 0 = Sunday … 6 = Saturday. */
  weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  /** The calendar's columns, Monday first. */
  dow: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  cadence: (weeks: number) => (weeks === 1 ? 'every week' : `every ${weeks} weeks`),

  // ─── Shared ───────────────────────────────────────────────────────────────
  loading: 'Loading…',
  cancel: 'Cancel',
  adding: 'Adding…',
  uploading: 'Uploading…',
  anyone: 'Anyone',
  someone: 'Someone',
  close: 'Close',
  videos: (n: number) => `${n} ${plural(n, 'video', 'videos')}`,
  pieces: (n: number) => `${n} ${plural(n, 'piece', 'pieces')}`,
  perMonth: (n: number) => `${n}/month`,
  postsAMonth: (n: number) => `${n} ${plural(n, 'post', 'posts')} a month`,
  newClient: 'New client',
  contentPlan: 'Content plan',
  viewPlan: 'View plan',

  // ─── Tasks, as the calendar writes them ───────────────────────────────────
  taskPlan: (name: string) => `Plan ${name}`,
  planFor: (date: string) => `for the ${date} shoot`,
  planUploaded: 'plan uploaded',
  taskRecord: (name: string) => `Record ${name}`,
  noPlanYet: 'No content plan yet',
  taskEdit: (name: string) => `Edit ${name}`,
  nothingToEdit: 'nothing recorded to edit',
  ofAvailable: (takes: number, available: number) => `${takes} of ${available} available`,
  editShort: (n: number) => `${n} more than had been recorded by then`,
  taskDeliver: (name: string) => `Deliver ${name}`,
  forApproval: (n: number) => `${n} ${plural(n, 'piece', 'pieces')} for approval`,
  beforeEdit: 'Before the edit',
  taskSchedule: (name: string) => `Schedule ${name}`,
  beforeDelivery: 'Before it has been delivered',
  taskPost: (what: string) => `Post ${what}`,
  nothingInTime: 'nothing ready in time',
  slotEmpty: 'Nothing ready in time for this day',
  batchTitle: (verb: string, n: number) => `${verb} ${n} ${plural(n, 'piece', 'pieces')}`,
  batchForApproval: 'for approval',

  // ─── The month ────────────────────────────────────────────────────────────
  title: 'Content calendar',
  notSetUpBefore: 'The content calendar is not set up in the database yet. Run the migration',
  notSetUpAfter: 'in the Supabase SQL editor, then reload.',
  prevMonth: 'Previous month',
  nextMonth: 'Next month',
  today: 'Today',
  lede: (n: number) =>
    `Planning, recording, editing and posting for ${n} ${plural(n, 'client', 'clients')}. Every piece of content is planned, shot, edited, delivered for approval, scheduled and posted. Tick each step off here or in the week lists below.`,
  allClients: 'All clients',
  showingOnly: (name: string) => `Showing ${name} only.`,
  openProfile: 'Open their profile →',
  showingAll: 'Showing all clients. Click a client to see only their schedule.',
  noClients: 'No clients yet',
  noClientsBody:
    'Add a client, then in their profile add recordings, editing sessions and posting days. They show up here.',
  addFirstClient: 'Add the first client',
  calendar: 'Calendar',
  legendPosts: 'Coloured tags are posts going live (client + piece number). Click one once it has gone out.',
  legendEmpty: 'a posting day with nothing ready',
  markDone: 'Mark as done',
  markNotDone: 'Mark as not done',
  postEmpty: (client: string) => `${client}: nothing edited, delivered and scheduled in time for this day`,
  postPosted: 'posted, click to undo',
  postWhenPosted: 'click when posted',

  // Week by week
  weekByWeek: 'Week by week',
  week: (n: number) => `Week ${n}`,
  toDo: (left: number, total: number) => `${left} of ${total} to do`,
  nothingThisWeek: 'Nothing to plan, record, edit or post this week.',
  postsGoingLive: 'Posts going live',
  typeScheduleAndPost: 'Schedule and post',
  typeLight: 'Light week',
  typePlanning: 'Planning',
  typePosting: 'Posting',
  typeEditing: (codes: string) => `Editing ${codes}`,
  nothingBooked: 'Nothing booked',

  // Posting schedule
  postingSchedule: 'Posting schedule',
  postingNote:
    "Each client has fixed posting days, set in their profile. A posting day publishes the next piece that has been edited, delivered and scheduled by then, in the order the pieces were shot. On scheduling days, load everything in the morning so that day's posts go out on time.",
  noPostingDaysIn: (month: string) => `No posting days in ${month}.`,
  colPiece: 'Piece',
  colGoesLive: 'Goes live',
  colBatch: 'Batch',
  colPosted: 'Posted',
  nothingReady: 'nothing ready',
  shotOn: (date: string) => `Shot ${date}`,

  // The rhythm
  rhythmAfter: (month: string) => `The rhythm after ${month}`,
  rhythmNote: 'The next eight weeks, as they are booked. A week with nothing shot or edited is a light week.',
  colWeekOf: 'Week of',
  colType: 'Type',
  free: 'Free',

  // Clients
  clients: 'Clients',
  archivedTag: 'archived',
  postsAMonthSuffix: (n: number) => plural(n, ' post a month', ' posts a month'),
  nextShootOn: (date: string) => `Next shoot ${date}`,
  noShootBooked: 'No shoot booked',
  toggleArchived: (showing: boolean, n: number) => `${showing ? 'Hide' : 'Show'} ${n} archived`,

  // ─── Plan viewer ──────────────────────────────────────────────────────────
  planOf: (name: string) => `Content plan · ${name}`,
  shootOn: (date: string, videos: string) => `Shoot on ${date} · ${videos}`,
  openNewTab: 'Open in a new tab',
  cannotShow: 'This file cannot be shown here.',
  openItNewTab: 'Open it in a new tab',
  noPlanAdded: 'No plan has been added yet.',

  // ─── Client form ──────────────────────────────────────────────────────────
  editClient: 'Edit client',
  name: 'Name',
  code: 'Code',
  postsPerMonthLabel: 'Posts a month',
  aboutAWeek: (n: string) => `About ${n} a week. Recording frequency is planned from this.`,
  colour: 'Colour',
  contact: 'Contact',
  handle: 'Handle',
  email: 'Email',
  phone: 'Phone',
  notes: 'Notes',
  notesPlaceholder: 'Tone, what they like, what to avoid, where they shoot…',
  nameRequired: 'Give the client a name.',
  saving: 'Saving…',
  save: 'Save',
  addClient: 'Add client',

  // ─── Client profile ───────────────────────────────────────────────────────
  clientGone: 'This client does not exist any more.',
  archived: 'Archived',
  editProfile: 'Edit profile',
  profile: 'Profile',
  edit: 'Edit',
  restore: 'Restore',
  archive: 'Archive',
  deleteClient: 'Delete client',
  cannotDeleteClient: 'This client was not deleted: only the account owner can delete clients.',
  confirmDeleteClient: (name: string) =>
    `Delete ${name} and all their recordings, edits, posting days and plans? This cannot be undone.`,
  tileRecorded: 'Recorded',
  shoots: (n: number) => `${n} ${plural(n, 'shoot', 'shoots')}`,
  tileEdited: 'Edited',
  waiting: (n: number) => `${n} waiting`,
  allCaughtUp: 'all caught up',
  tileBooked: 'Booked',
  waitingForDay: (n: number) => `${n} waiting for a day`,
  allHaveADay: 'all have a day',
  tilePosted: 'Posted',
  toGo: (n: number) => `${n} to go`,
  emptyAhead: (n: number, dates: string) =>
    `${n} posting ${plural(n, 'day', 'days')} in the next two months ${plural(n, 'has', 'have')} nothing ready in time: ${endSentence(dates)} Book a shoot, or bring an edit, delivery or scheduling day forward.`,
  stageRecordings: 'Recordings',
  stageEditing: 'Editing',
  stageDeliveryScheduling: 'Delivery and scheduling',
  stagePosting: 'Posting',
  stagePieces: 'Every piece',
  recordingsIntro:
    'Every shoot needs a content plan first — it is a task of its own, due a few days before, with a place to upload the plan.',
  editingIntro:
    'Drag the bar to choose how many of the recorded videos a session edits. It can only take what has been recorded by its day and not edited yet, oldest first. Delivery and scheduling for each batch are in the next step.',
  deliveryIntro:
    'Every edited batch goes to the client for approval, then into the scheduler. Its pieces can only go out from the day it is scheduled.',
  noBatches: 'Batches appear here once an editing session is added.',
  editedOnDay: (date: string) => `edited ${date}`,
  postingIntro: 'Pick the days they post. Each posting day publishes the next piece that has been edited, delivered and scheduled by then.',
  noPieces: 'Pieces appear here once a recording is added.',
  colRecorded: 'Recorded',
  colEdited: 'Edited',
  colDelivered: 'Delivered',
  colScheduled: 'Scheduled',
  notYet: 'not yet',
  noPostingDayYet: 'no posting day yet',

  // The editing bar
  noneAvailable: '0 available',
  sliderValue: (v: number, max: number) => `${v} / ${max} videos`,

  // Recordings
  addRecording: 'Add recording',
  firstShoot: 'First shoot',
  videosPerShoot: 'Videos per shoot',
  repeat: 'Repeat',
  justOnce: 'Just once',
  everyN: (n: number) => (n === 1 ? 'Every week' : `Every ${n} weeks`),
  howManyShoots: 'How many shoots',
  recordedBy: 'Recorded by',
  planDue: 'Content plan due',
  dayOfShoot: 'The day of the shoot',
  daysBefore: (n: number) => `${n} ${plural(n, 'day', 'days')} before`,
  plannedBy: 'Planned by',
  cadenceHint: (target: number, pieces: number, shoots: string, cadence: string) =>
    `${target} posts a month at ${pieces} videos a shoot is about ${shoots} shoots a month — record ${cadence}.`,
  useThat: 'Use that',
  shootsSummary: (n: number) => (n === 1 ? 'One shoot' : `${n} shoots`),
  addRecordings: (n: number) => (n === 1 ? 'Add recording' : `Add ${n} recordings`),
  videosLabel: 'videos',
  editedOf: (edited: number, of: number) => `${edited} of ${of} edited`,
  recordedByEllipsis: 'Recorded by…',
  recordedDone: 'Recorded',
  confirmDeleteRecording: (date: string) => `Delete the ${date} recording and its plan?`,
  deleteRecording: 'Delete recording',
  due: 'due',
  plannedByEllipsis: 'Planned by…',
  plannedDone: 'Planned',
  replace: 'Replace',
  removeFile: 'Remove file',
  uploadPlan: 'Upload plan',
  writeItHere: 'Write it here',
  view: 'View',
  planPlaceholder: (n: number) => `Ideas, hooks, shot list for the ${n} ${plural(n, 'video', 'videos')}…`,

  // Editing
  addEditing: 'Add editing session',
  addRecordingFirst: 'Add a recording first',
  editingDay: 'Editing day',
  videosToEdit: 'Videos to edit',
  editedBy: 'Edited by',
  availableBy: (date: string, recorded: number, taken: number, available: number) =>
    `By ${date}: ${recorded} recorded, ${taken} already edited, so ${available} available`,
  pickAfterShoot: ' — pick a day after a shoot.',
  deliverForApproval: 'Deliver for approval',
  scheduleLabel: 'Schedule',
  canGoOutFrom: (date: string) => endSentence(`These pieces can start going out from ${date}`),
  editN: (n: number) => `Edit ${n} ${plural(n, 'video', 'videos')}`,
  editedByEllipsis: 'Edited by…',
  editedDone: 'Edited',
  confirmDeleteEdit: 'Delete this editing session?',
  deleteEdit: 'Delete editing session',
  setToButOnly: (set: number, only: number) =>
    `Set to ${set}, but only ${only} had been recorded and not edited by then.`,
  delivery: 'Delivery',
  scheduling: 'Scheduling',
  delivered: 'Delivered',
  scheduled: 'Scheduled',
  noDelivery: 'No delivery for this batch',
  noScheduling: 'No scheduling for this batch',
  readyToPostFrom: (date: string) => `Ready to post from ${date}`,

  // Posting
  addPostingDays: 'Add posting days',
  postOn: 'Post on',
  every: 'Every',
  weekOption: 'Week',
  twoWeeksOption: '2 weeks',
  from: 'From',
  untilOptional: 'Until (optional)',
  postedBy: 'Posted by',
  pickDays: 'Pick the days of the week they post.',
  daysHint: (days: number, everyWeeks: number, perMonth: number, target: number) =>
    `${days} ${plural(days, 'day', 'days')} ${everyWeeks === 1 ? 'a week' : 'every 2 weeks'} is about ${perMonth} posts a month — the target is ${target}.`,
  everyWeekOption: 'every week',
  everyTwoWeeksOption: 'every 2 weeks',
  fromLower: 'from',
  untilLower: 'until',
  postedByEllipsis: 'Posted by…',
  approxPerMonth: (n: number) => `≈ ${n}/month`,
  confirmDeleteRule: 'Delete these posting days?',
  deleteRule: 'Delete posting days',
}

const pt: typeof en = {
  // ─── Etapas ───────────────────────────────────────────────────────────────
  stage: {
    plan: 'Plano de conteúdo',
    record: 'Gravação',
    edit: 'Edição',
    deliver: 'Entrega',
    schedule: 'Agendamento',
    post: 'Publicação',
  },
  verb: {
    plan: 'Planear',
    record: 'Gravar',
    edit: 'Editar',
    deliver: 'Entregar',
    schedule: 'Agendar',
    post: 'Publicar',
  },
  weekday: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
  dow: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'],
  cadence: (weeks: number) => (weeks === 1 ? 'todas as semanas' : `a cada ${weeks} semanas`),

  // ─── Comum ────────────────────────────────────────────────────────────────
  loading: 'A carregar…',
  cancel: 'Cancelar',
  adding: 'A adicionar…',
  uploading: 'A carregar…',
  anyone: 'Qualquer pessoa',
  someone: 'Alguém',
  close: 'Fechar',
  videos: (n: number) => `${n} ${plural(n, 'vídeo', 'vídeos')}`,
  pieces: (n: number) => `${n} ${plural(n, 'peça', 'peças')}`,
  perMonth: (n: number) => `${n}/mês`,
  postsAMonth: (n: number) => `${n} ${plural(n, 'publicação', 'publicações')} por mês`,
  newClient: 'Novo cliente',
  contentPlan: 'Plano de conteúdo',
  viewPlan: 'Ver plano',

  // ─── Tarefas, como aparecem no calendário ─────────────────────────────────
  taskPlan: (name: string) => `Planear ${name}`,
  planFor: (date: string) => `para a gravação de ${date}`,
  planUploaded: 'plano carregado',
  taskRecord: (name: string) => `Gravar ${name}`,
  noPlanYet: 'Ainda sem plano de conteúdo',
  taskEdit: (name: string) => `Editar ${name}`,
  nothingToEdit: 'nada gravado para editar',
  ofAvailable: (takes: number, available: number) => `${takes} de ${available} disponíveis`,
  editShort: (n: number) => `${n} a mais do que o que estava gravado até então`,
  taskDeliver: (name: string) => `Entregar ${name}`,
  forApproval: (n: number) => `${n} ${plural(n, 'peça', 'peças')} para aprovação`,
  beforeEdit: 'Antes da edição',
  taskSchedule: (name: string) => `Agendar ${name}`,
  beforeDelivery: 'Antes da entrega',
  taskPost: (what: string) => `Publicar ${what}`,
  nothingInTime: 'nada pronto a tempo',
  slotEmpty: 'Nada pronto a tempo para este dia',
  batchTitle: (verb: string, n: number) => `${verb} ${n} ${plural(n, 'peça', 'peças')}`,
  batchForApproval: 'para aprovação',

  // ─── O mês ────────────────────────────────────────────────────────────────
  title: 'Calendário de conteúdo',
  notSetUpBefore: 'O calendário de conteúdo ainda não está configurado na base de dados. Execute a migração',
  notSetUpAfter: 'no editor SQL do Supabase e recarregue a página.',
  prevMonth: 'Mês anterior',
  nextMonth: 'Mês seguinte',
  today: 'Hoje',
  lede: (n: number) =>
    `Planeamento, gravação, edição e publicação para ${n} ${plural(n, 'cliente', 'clientes')}. Cada peça de conteúdo é planeada, gravada, editada, entregue para aprovação, agendada e publicada. Marque cada passo aqui ou nas listas semanais abaixo.`,
  allClients: 'Todos os clientes',
  showingOnly: (name: string) => `A mostrar só ${name}.`,
  openProfile: 'Abrir o perfil →',
  showingAll: 'A mostrar todos os clientes. Clique num cliente para ver só o calendário dele.',
  noClients: 'Ainda não há clientes',
  noClientsBody:
    'Adicione um cliente e, no perfil dele, adicione gravações, sessões de edição e dias de publicação. Aparecem aqui.',
  addFirstClient: 'Adicionar o primeiro cliente',
  calendar: 'Calendário',
  legendPosts:
    'As etiquetas coloridas são publicações que vão para o ar (cliente + número da peça). Clique numa depois de publicada.',
  legendEmpty: 'um dia de publicação sem nada pronto',
  markDone: 'Marcar como feito',
  markNotDone: 'Marcar como por fazer',
  postEmpty: (client: string) => `${client}: nada editado, entregue e agendado a tempo para este dia`,
  postPosted: 'publicado, clique para desfazer',
  postWhenPosted: 'clique quando for publicado',

  weekByWeek: 'Semana a semana',
  week: (n: number) => `Semana ${n}`,
  toDo: (left: number, total: number) => `${left} de ${total} por fazer`,
  nothingThisWeek: 'Nada para planear, gravar, editar ou publicar esta semana.',
  postsGoingLive: 'Publicações da semana',
  typeScheduleAndPost: 'Agendar e publicar',
  typeLight: 'Semana leve',
  typePlanning: 'Planeamento',
  typePosting: 'Publicação',
  typeEditing: (codes: string) => `Edição ${codes}`,
  nothingBooked: 'Nada marcado',

  postingSchedule: 'Calendário de publicações',
  postingNote:
    'Cada cliente tem dias fixos de publicação, definidos no seu perfil. Cada dia de publicação publica a próxima peça já editada, entregue e agendada até esse dia, pela ordem em que as peças foram gravadas. Nos dias de agendamento, carregue tudo de manhã para que as publicações desse dia saiam a horas.',
  noPostingDaysIn: (month: string) => `Sem dias de publicação em ${month}.`,
  colPiece: 'Peça',
  colGoesLive: 'Publicação',
  colBatch: 'Gravação',
  colPosted: 'Publicado',
  nothingReady: 'nada pronto',
  // The column is headed "Gravação", so the date says it alone.
  shotOn: (date: string) => date,

  rhythmAfter: (month: string) => `O ritmo depois de ${month}`,
  rhythmNote:
    'As próximas oito semanas, tal como estão marcadas. Uma semana sem gravações nem edições é uma semana leve.',
  colWeekOf: 'Semana de',
  colType: 'Tipo',
  free: 'Livre',

  clients: 'Clientes',
  archivedTag: 'arquivado',
  postsAMonthSuffix: (n: number) => plural(n, ' publicação por mês', ' publicações por mês'),
  nextShootOn: (date: string) => `Próxima gravação: ${date}`,
  noShootBooked: 'Nenhuma gravação marcada',
  toggleArchived: (showing: boolean, n: number) =>
    `${showing ? 'Esconder' : 'Mostrar'} ${n} ${plural(n, 'arquivado', 'arquivados')}`,

  // ─── Visualizador do plano ────────────────────────────────────────────────
  planOf: (name: string) => `Plano de conteúdo · ${name}`,
  shootOn: (date: string, videos: string) => `Gravação a ${date} · ${videos}`,
  openNewTab: 'Abrir num novo separador',
  cannotShow: 'Este ficheiro não pode ser mostrado aqui.',
  openItNewTab: 'Abrir num novo separador',
  noPlanAdded: 'Ainda não foi adicionado nenhum plano.',

  // ─── Ficha do cliente ─────────────────────────────────────────────────────
  editClient: 'Editar cliente',
  name: 'Nome',
  code: 'Código',
  postsPerMonthLabel: 'Publicações por mês',
  aboutAWeek: (n: string) => `Cerca de ${n} por semana. A frequência das gravações é planeada a partir daqui.`,
  colour: 'Cor',
  contact: 'Contacto',
  handle: 'Conta',
  email: 'E-mail',
  phone: 'Telefone',
  notes: 'Notas',
  notesPlaceholder: 'Tom, o que gostam, o que evitar, onde se grava…',
  nameRequired: 'Dê um nome ao cliente.',
  saving: 'A guardar…',
  save: 'Guardar',
  addClient: 'Adicionar cliente',

  // ─── Perfil do cliente ────────────────────────────────────────────────────
  clientGone: 'Este cliente já não existe.',
  archived: 'Arquivado',
  editProfile: 'Editar perfil',
  profile: 'Perfil',
  edit: 'Editar',
  restore: 'Restaurar',
  archive: 'Arquivar',
  deleteClient: 'Eliminar cliente',
  cannotDeleteClient: 'Este cliente não foi eliminado: só o dono da conta pode eliminar clientes.',
  confirmDeleteClient: (name: string) =>
    `Eliminar ${name} e todas as gravações, edições, dias de publicação e planos? Isto não pode ser desfeito.`,
  tileRecorded: 'Gravadas',
  shoots: (n: number) => `${n} ${plural(n, 'gravação', 'gravações')}`,
  tileEdited: 'Editadas',
  waiting: (n: number) => `${n} à espera`,
  allCaughtUp: 'tudo em dia',
  tileBooked: 'Marcadas',
  waitingForDay: (n: number) => `${n} à espera de dia`,
  allHaveADay: 'todas têm dia',
  tilePosted: 'Publicadas',
  toGo: (n: number) => `${plural(n, 'falta', 'faltam')} ${n}`,
  emptyAhead: (n: number, dates: string) =>
    `${n} ${plural(n, 'dia', 'dias')} de publicação nos próximos dois meses ${plural(n, 'não tem', 'não têm')} nada pronto a tempo: ${endSentence(dates)} Marque uma gravação, ou antecipe um dia de edição, entrega ou agendamento.`,
  stageRecordings: 'Gravações',
  stageEditing: 'Edição',
  stageDeliveryScheduling: 'Entrega e agendamento',
  stagePosting: 'Publicação',
  stagePieces: 'Todas as peças',
  recordingsIntro:
    'Cada gravação precisa primeiro de um plano de conteúdo — é uma tarefa própria, com prazo uns dias antes e um sítio para carregar o plano.',
  editingIntro:
    'Arraste a barra para escolher quantos dos vídeos gravados uma sessão edita. Só pode incluir o que já foi gravado até esse dia e ainda não foi editado, dos mais antigos para os mais recentes. A entrega e o agendamento de cada lote estão no passo seguinte.',
  deliveryIntro:
    'Cada lote editado vai ao cliente para aprovação e depois é agendado. As suas peças só podem sair a partir do dia em que é agendado.',
  noBatches: 'Os lotes aparecem aqui quando for adicionada uma sessão de edição.',
  editedOnDay: (date: string) => `editado a ${date}`,
  postingIntro:
    'Escolha os dias em que publicam. Cada dia de publicação publica a próxima peça já editada, entregue e agendada até esse dia.',
  noPieces: 'As peças aparecem aqui quando for adicionada uma gravação.',
  colRecorded: 'Gravada',
  colEdited: 'Editada',
  colDelivered: 'Entregue',
  colScheduled: 'Agendada',
  notYet: 'ainda não',
  noPostingDayYet: 'ainda sem dia de publicação',

  noneAvailable: '0 disponíveis',
  sliderValue: (v: number, max: number) => `${v} / ${max} vídeos`,

  addRecording: 'Adicionar gravação',
  firstShoot: 'Primeira gravação',
  videosPerShoot: 'Vídeos por gravação',
  repeat: 'Repetir',
  justOnce: 'Só uma vez',
  everyN: (n: number) => (n === 1 ? 'Todas as semanas' : `A cada ${n} semanas`),
  howManyShoots: 'Quantas gravações',
  recordedBy: 'Gravado por',
  planDue: 'Prazo do plano de conteúdo',
  dayOfShoot: 'No dia da gravação',
  daysBefore: (n: number) => `${n} ${plural(n, 'dia', 'dias')} antes`,
  plannedBy: 'Planeado por',
  cadenceHint: (target: number, pieces: number, shoots: string, cadence: string) =>
    `${target} publicações por mês com ${pieces} vídeos por gravação dá cerca de ${shoots} gravações por mês — grave ${cadence}.`,
  useThat: 'Usar isso',
  shootsSummary: (n: number) => (n === 1 ? 'Uma gravação' : `${n} gravações`),
  addRecordings: (n: number) => (n === 1 ? 'Adicionar gravação' : `Adicionar ${n} gravações`),
  videosLabel: 'vídeos',
  editedOf: (edited: number, of: number) => `${edited} de ${of} editados`,
  recordedByEllipsis: 'Gravado por…',
  recordedDone: 'Gravado',
  confirmDeleteRecording: (date: string) => `Eliminar a gravação de ${date} e o respetivo plano?`,
  deleteRecording: 'Eliminar gravação',
  due: 'prazo',
  plannedByEllipsis: 'Planeado por…',
  plannedDone: 'Planeado',
  replace: 'Substituir',
  removeFile: 'Remover ficheiro',
  uploadPlan: 'Carregar plano',
  writeItHere: 'Escrever aqui',
  view: 'Ver',
  planPlaceholder: (n: number) =>
    n === 1 ? 'Ideias, ganchos, lista de planos para o vídeo…' : `Ideias, ganchos, lista de planos para os ${n} vídeos…`,

  addEditing: 'Adicionar sessão de edição',
  addRecordingFirst: 'Adicione primeiro uma gravação',
  editingDay: 'Dia de edição',
  videosToEdit: 'Vídeos a editar',
  editedBy: 'Editado por',
  availableBy: (date: string, recorded: number, taken: number, available: number) =>
    `Até ${date}: ${recorded} gravados, ${taken} já editados, portanto ${available} disponíveis`,
  pickAfterShoot: ' — escolha um dia depois de uma gravação.',
  deliverForApproval: 'Entregar para aprovação',
  scheduleLabel: 'Agendar',
  canGoOutFrom: (date: string) => endSentence(`Estas peças podem começar a sair a partir de ${date}`),
  editN: (n: number) => `Editar ${n} ${plural(n, 'vídeo', 'vídeos')}`,
  editedByEllipsis: 'Editado por…',
  editedDone: 'Editado',
  confirmDeleteEdit: 'Eliminar esta sessão de edição?',
  deleteEdit: 'Eliminar sessão de edição',
  setToButOnly: (set: number, only: number) =>
    `Definido para ${set}, mas só ${only} estavam gravados e por editar até então.`,
  delivery: 'Entrega',
  scheduling: 'Agendamento',
  delivered: 'Entregue',
  scheduled: 'Agendado',
  noDelivery: 'Sem entrega para este lote',
  noScheduling: 'Sem agendamento para este lote',
  readyToPostFrom: (date: string) => `Pronto a publicar a partir de ${date}`,

  addPostingDays: 'Adicionar dias de publicação',
  postOn: 'Dias de publicação',
  every: 'A cada',
  weekOption: 'Semana',
  twoWeeksOption: '2 semanas',
  from: 'De',
  untilOptional: 'Até (opcional)',
  postedBy: 'Publicado por',
  pickDays: 'Escolha os dias da semana em que publicam.',
  daysHint: (days: number, everyWeeks: number, perMonth: number, target: number) =>
    `${days} ${plural(days, 'dia', 'dias')} ${everyWeeks === 1 ? 'por semana' : 'a cada 2 semanas'} dá cerca de ${perMonth} publicações por mês — a meta é ${target}.`,
  everyWeekOption: 'todas as semanas',
  everyTwoWeeksOption: 'a cada 2 semanas',
  fromLower: 'de',
  untilLower: 'até',
  postedByEllipsis: 'Publicado por…',
  approxPerMonth: (n: number) => `≈ ${n}/mês`,
  confirmDeleteRule: 'Eliminar estes dias de publicação?',
  deleteRule: 'Eliminar dias de publicação',
}

export type ContentStrings = typeof en

/**
 * The content calendar's words, and its dates written the same way. Always
 * Portuguese rather than the language switch's choice: following the switch
 * left the tab in English for anyone with the app on English, and the team it
 * is for works in Portuguese. Dates use the Brazilian style ("seg., 5 de out."), as the rest of the app's
 * Portuguese dates do: the European one writes "segunda, 5/10", which reads
 * worse in a calendar cell.
 */
export function useContentT() {
  return {
    c: pt,
    lang: 'pt' as const,
    fmt: (day: string, opts?: Intl.DateTimeFormatOptions) => formatDay(day, opts, 'pt-BR'),
  }
}
