export type ActivationState = 'UNKNOWN_LEGACY' | 'NOT_ACTIVATED' | 'ACTIVATED';
export type ActivityStatus = 'UNKNOWN' | 'ACTIVE' | 'MEDIUM' | 'INACTIVE';

export interface CurrentUser {
  sub: string;
  name: string;
  email?: string;
  roles: string[];
  permissions: string[];
}

export interface ContactPoint {
  id: string;
  type: 'EMAIL' | 'PHONE' | 'TELEGRAM' | 'MAX' | 'OTHER';
  rawValue: string;
  telegramUserId?: string | null;
  isIdentity?: boolean;
  isPrimary: boolean;
}

export interface PersonSummary {
  id: string;
  canonicalFullName: string;
  lastName: string;
  firstName: string;
  patronymic: string;
  organization?: string | null;
  faculty?: string | null;
  primaryContact?: string | null;
  ownerName?: string | null;
  activationState: ActivationState;
  activityStatus: ActivityStatus;
  lastArtifactAt?: string | null;
  countableArtifactCount: number;
  latestArtifactScore?: number | null;
  hasDuplicateCandidate: boolean;
  tags?: string[];
}

export interface PersonDetail extends PersonSummary {
  version: number;
  activatedAt?: string | null;
  nextStatusTransitionAt?: string | null;
  lifecycleDataState: 'LEGACY_INCOMPLETE' | 'COMPLETE';
  contacts: ContactPoint[];
  aliases: { id: string; rawValue: string }[];
  affiliations: {
    id: string;
    organization: string;
    faculty?: string | null;
    role?: string | null;
  }[];
  artifacts: ArtifactSummary[];
  events: PersonEventSummary[];
  tasks: TaskSummary[];
  sources: SourceSummary[];
  /** Free-form editable notes; initially collated from imported source data. */
  notes?: string | null;
  /** Индекс качества головы Q_head. */
  headQuality?: HeadQuality;
  /** Согласие на рассылки по каналам: отписка исключает из аудиторий, но не из базы. */
  marketingConsent?: { telegram: ConsentStatus; email: ConsentStatus };
}

export type ConsentStatus = 'GRANTED' | 'DENIED' | 'UNKNOWN' | 'WITHDRAWN';

export interface ArtifactSummary {
  id: string;
  title: string;
  typeName: string;
  eventId?: string | null;
  eventName?: string | null;
  status: string;
  latestVersionId?: string | null;
  latestVersionNumber?: number | null;
  latestVersionStatus?: string | null;
  submittedAt?: string | null;
  score?: number | null;
  decision?: 'ACCEPTED' | 'REJECTED' | 'NEEDS_REVISION' | null;
  reviewedAt?: string | null;
  authors?: { id: string; name: string }[];
}

export interface EventParticipationSummary {
  id: string;
  /** The current data model has no event-role column, so legacy imports return null. */
  role?: string | null;
  registeredAt?: string | null;
  decision: 'UNKNOWN' | 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WAITLISTED';
  decisionAt?: string | null;
  attendance: 'UNKNOWN' | 'ATTENDED' | 'NO_SHOW' | 'PARTIAL';
  attendedAt?: string | null;
  dataOrigin: 'LEGACY_IMPORT' | 'LIVE';
  comments: string[];
  sources: SourceSummary[];
}

export interface PersonEventSummary {
  id: string;
  name: string;
  status: string;
  startsAt?: string | null;
  endsAt?: string | null;
  participations: EventParticipationSummary[];
  artifacts: ArtifactSummary[];
}

export interface EventSummary {
  id: string;
  name: string;
  status: string;
  startsAt?: string | null;
  endsAt?: string | null;
  version: number;
  participantCount: number;
  artifactCount: number;
}

export interface EventArtifactFile {
  id: string;
  fileName: string;
  sizeBytes: number | null;
  status: string;
  storageProvider: 'CRM' | 'LOCKER';
}

export interface EventArtifact {
  id: string;
  title: string;
  typeName: string;
  status: string;
  latestVersionId: string | null;
  latestVersionNumber: number | null;
  latestVersionStatus: string | null;
  submittedAt: string | null;
  score: number | null;
  decision: 'ACCEPTED' | 'REJECTED' | 'NEEDS_REVISION' | null;
  reviewedAt: string | null;
  reviewerName: string | null;
  source: 'LOCKER' | 'CRM';
  authors: { id: string; name: string; isParticipant: boolean }[];
  files: EventArtifactFile[];
  externalUrls: string[];
  authorOutsideEvent: boolean;
}

export interface EventArtifactsResponse {
  items: EventArtifact[];
  participants: { id: string; canonicalFullName: string }[];
}

export interface EventDuplicateSuggestion {
  id: string;
  canonicalFullName: string;
  telegram: string | null;
  artifactCount: number;
  createdAt: string | null;
  /** Карточку спрятала гигиена ФИО — в реестре участников её не найти. */
  hidden: boolean;
  suggestions: {
    id: string;
    canonicalFullName: string;
    telegram: string | null;
    nameOverlap: boolean;
    openCandidateId: string | null;
  }[];
}

export interface EventParticipantSummary {
  id: string;
  canonicalFullName: string;
  primaryContact?: string | null;
  activationState: ActivationState;
  activityStatus: ActivityStatus;
  lastArtifactAt?: string | null;
  participationCount: number;
  decisions: string[];
  attendances: string[];
  comments: string[];
  sourceCount: number;
  artifactCount: number;
  artifacts: ArtifactSummary[];
}

export interface EventDetail {
  id: string;
  name: string;
  status: string;
  startsAt?: string | null;
  endsAt?: string | null;
  version: number;
  participants: EventParticipantSummary[];
}

export interface EventAttendanceImportResult {
  eventId: string;
  eventName: string;
  dataRows: number;
  attendedRows: number;
  duplicateRows: number;
  resolved: number;
  added: number;
  markedAttended: number;
  alreadyAttended: number;
  invalid: { rowNumber: number; rawFullName: string; reason: string }[];
  unmatched: { rowNumber: number; fullName: string }[];
  ambiguous: { rowNumber: number; fullName: string }[];
}

export interface ArtifactVersionDetail {
  id: string;
  artifactId: string;
  title: string;
  typeName: string;
  versionNumber: number;
  status: string;
  contentType: 'FILE' | 'EXTERNAL_URL' | 'TEXT' | 'MIXED';
  textContent?: string | null;
  submittedAt?: string | null;
  canReview: boolean;
  contributors: {
    id: string;
    name: string;
    role: 'AUTHOR' | 'CONTRIBUTOR';
  }[];
  externalUrls: string[];
  files: {
    id: string;
    fileName: string;
    status: string;
  }[];
  currentReview?: {
    id: string;
    score: number;
    decision: 'NEEDS_REVISION' | 'ACCEPTED' | 'REJECTED';
    comment?: string | null;
    reviewerName?: string | null;
    reviewedAt: string;
  } | null;
}

export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export interface TaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  dueAt?: string | null;
  version?: number;
  description?: string | null;
  isNextStep?: boolean;
  personId?: string | null;
  personName?: string | null;
  projectId?: string | null;
  completedAt?: string | null;
  result?: string | null;
  createdAt?: string | null;
  assigneeUserId?: string | null;
  assigneeName?: string | null;
}

export interface TasksResponse {
  items: TaskSummary[];
}

/** Отправка из бота, которую CRM не смогла привязать к участнику автоматически. */
export interface LockerPendingSubmission {
  id: string;
  lockerSubmissionId: string;
  telegram: string;
  telegramUserId: string;
  reportedFullName: string;
  reportedPhone: string | null;
  reportedOrganization: string | null;
  eventTitle: string;
  submittedAt: string;
  reasonCode: 'FIO_REQUIRED' | 'PERSON_AMBIGUOUS' | 'IDENTITY_CONFLICT' | 'DELETED_IDENTITY';
  reasonLabel: string;
  reasonDetail: string | null;
  status: 'PENDING' | 'RESOLVED' | 'REJECTED';
  attempts: number;
  fileCount: number;
  resolvedPersonId: string | null;
  resolvedPersonName: string | null;
  resolvedAt: string | null;
}

export interface LockerPendingResponse {
  pendingCount: number;
  items: LockerPendingSubmission[];
}

export interface SourceSummary {
  id: string;
  fileName: string;
  sheetName: string;
  rowNumber: number;
  relation: string;
  fields?: { header: string; address: string; value: string }[];
}

export interface PeopleResponse {
  items: PersonSummary[];
  nextCursor: string | null;
  total: number;
}

export interface DashboardMetrics {
  totalPeople: number;
  activatedEver: number;
  active: number;
  medium: number;
  inactive: number;
  notActivated: number;
  unknownLegacy: number;
  unreviewedArtifacts: number;
  duplicateCandidates: number;
  overdueTasks: number;
  recentVersions: number;
  recentAuthors: number;
  eventCount: number;
  scoreDistribution: { score: number; count: number }[];
}

export interface ImportRunSummary {
  id: string;
  mode: 'DRY_RUN' | 'COMMIT' | 'REVERT';
  status: string;
  fileName: string;
  sheetsProcessed: number;
  sourceRecords: number;
  observations: number;
  personsCreated: number;
  personsLinked: number;
  duplicatesQueued: number;
  rejected: number;
  quarantined: number;
  createdAt: string;
  report?: Record<string, unknown>;
}

export type PartnerKind =
  'COMMERCIAL' | 'GRANT_FUND' | 'UNIVERSITY' | 'GOVERNMENT' | 'MEDIA' | 'OTHER';
export type PartnerStatus = 'PROSPECT' | 'DEVELOPING' | 'ACTIVE' | 'PAUSED' | 'CLOSED';
export type AgreementType = 'GRANT' | 'COMMERCIAL' | 'PARTNERSHIP' | 'INFO_PARTNERSHIP';
export type AgreementStatus = 'DRAFT' | 'NEGOTIATION' | 'ACTIVE' | 'COMPLETED' | 'TERMINATED';
export type ProductStatus = 'IDEA' | 'PACKAGING' | 'ON_SALE' | 'CLOSED';
export type DealType = 'GRANT' | 'COMMERCIAL';
export type DealStatus = 'LEAD' | 'NEGOTIATION' | 'WON' | 'LOST';

export interface PartnerSummary {
  id: string;
  name: string;
  kind: PartnerKind;
  status: PartnerStatus;
  inn?: string | null;
  website?: string | null;
  version: number;
  ownerName?: string | null;
  activeAgreements: number;
  contactCount: number;
  lastInteractionAt?: string | null;
  wonAmount: number;
}

export interface PartnerContact {
  id: string;
  fullName: string;
  position?: string | null;
  isDecisionMaker: boolean;
  email?: string | null;
  phone?: string | null;
  telegram?: string | null;
  notes?: string | null;
}

export interface PartnerAgreement {
  id: string;
  title: string;
  agreementType: AgreementType;
  status: AgreementStatus;
  amount?: number | null;
  signedAt?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  comment?: string | null;
  version: number;
}

export interface PartnerInteraction {
  id: string;
  channel: string;
  direction: string;
  occurredAt: string;
  outcome?: string | null;
  comment?: string | null;
  contactName?: string | null;
  authorName?: string | null;
}

export interface PartnerDealSummary {
  id: string;
  title: string;
  dealType: DealType;
  status: DealStatus;
  amount: number;
  closedAt?: string | null;
  productName?: string | null;
}

export interface PartnerDetail {
  id: string;
  name: string;
  kind: PartnerKind;
  status: PartnerStatus;
  inn?: string | null;
  website?: string | null;
  notes?: string | null;
  version: number;
  ownerName?: string | null;
  createdAt?: string | null;
  contacts: PartnerContact[];
  agreements: PartnerAgreement[];
  interactions: PartnerInteraction[];
  deals: PartnerDealSummary[];
}

export interface ProductSummary {
  id: string;
  name: string;
  description?: string | null;
  deliveryModel?: string | null;
  documentationUrl?: string | null;
  status: ProductStatus;
  price?: number | null;
  closedAt?: string | null;
  closeReason?: string | null;
  version: number;
  ownerName?: string | null;
  dealCount: number;
  wonAmount: number;
}

export interface DealSummary {
  id: string;
  title: string;
  dealType: DealType;
  status: DealStatus;
  amount: number;
  currency: string;
  expectedCloseAt?: string | null;
  closedAt?: string | null;
  comment?: string | null;
  version: number;
  createdAt?: string | null;
  partnerId?: string | null;
  partnerName?: string | null;
  productName?: string | null;
  ownerName?: string | null;
  paidAt?: string | null;
  paidAmount?: number | null;
  personId?: string | null;
  personName?: string | null;
}

export type ExpenseCategory = 'VARIABLE' | 'OPEX' | 'BACK_OFFICE' | 'ACQUISITION' | 'ACTIVATION';

export interface ExpenseSummary {
  id: string;
  category: ExpenseCategory;
  amount: number;
  currency: string;
  occurredAt: string | null;
  description: string;
  version: number;
  createdAt?: string | null;
  eventId?: string | null;
  eventName?: string | null;
  productId?: string | null;
  productName?: string | null;
  dealId?: string | null;
  dealTitle?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  ownerName?: string | null;
}

/** Панель метрик ЦПИ (документ «ЦПИ: метрики и рабочие определения»). */
export interface CpiMetrics {
  period: { from: string; to: string };
  economics: {
    revenue: number;
    paidDeals: number;
    variableExpenses: number;
    flow: number;
    averageCheck: number | null;
    opexExpenses: number;
    backOfficeExpenses: number;
    opexPercent: number | null;
    backOfficePercent: number | null;
    activeHeadsStart: number;
    activeHeadsEnd: number;
    revenuePerActiveHead: number | null;
  };
  funnel: {
    newPeople: number;
    acquisitionExpenses: number;
    costPerNewPerson: number | null;
    actualParticipants: number;
    qualityArtifactAuthors: number;
    artifactConversion: number | null;
    directExpenses: number;
    costPerQualityAuthor: number | null;
    reviewedArtifacts: number;
    averageQArtifact: number | null;
  };
  activation: {
    firstQualityAuthors: number;
    newActivatedHeads: number;
    activationRate: number | null;
    activationExpenses: number;
    activationCost: number | null;
    activeAtStart: number;
    churnedFromStart: number;
    churn90: number | null;
    retention: number | null;
  };
  monetization: {
    activatedHeads: number;
    monetizedHeads: number;
    monetizationRate: number | null;
    partnerRevenue: number;
    activePartners: number;
    revenuePerActivePartner: number | null;
    products: {
      productId: string;
      name: string;
      revenue: number;
      variableExpenses: number;
      flow: number;
    }[];
  };
}

export type CampaignChannel = 'TELEGRAM' | 'EMAIL';
export type CampaignStatus =
  | 'DRAFT'
  | 'APPROVED'
  | 'SENDING'
  | 'PAUSED'
  | 'SENT'
  | 'CANCELLED';

export interface CampaignButton {
  text: string;
  action: 'INTERESTED' | 'MORE_INFO' | 'UNSUBSCRIBED' | 'URL';
  url?: string;
}

export interface CampaignSegment {
  hasArtifact?: boolean;
  lastArtifactWithinDays?: number;
  incompleteProfile?: boolean;
  eventIds?: string[];
  includeHidden?: boolean;
}

export interface Campaign {
  id: string;
  name: string;
  channel: CampaignChannel;
  status: CampaignStatus;
  goal: string | null;
  subject: string | null;
  body: string;
  buttons: CampaignButton[];
  segment: CampaignSegment;
  waveSize: number;
  messagesPerSecond: number;
  sentCount: number;
  failedCount: number;
  approvedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  version: number;
}

export interface CampaignAttachment {
  id: string;
  kind: 'PHOTO' | 'DOCUMENT';
  position: number;
  fileObjectId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface CampaignDetail extends Campaign {
  attachments: CampaignAttachment[];
  stats: {
    queued: number;
    sent: number;
    delivered: number;
    failed: number;
    interested: number;
    moreInfo: number;
    unsubscribed: number;
    opened: number;
    clicked: number;
    bounced: number;
  };
}

export interface CampaignAudience {
  total: number;
  alreadyQueued: number;
  sample: { name: string; address: string; preview: string }[];
}

/** Достижимость базы по каналам: кому вообще можно отправить рассылку. */
export interface AudienceReachability {
  total: number;
  channels: {
    telegramBot: number;
    telegramUsernameOnly: number;
    email: number;
    phone: number;
    unreachable: number;
    /** Нажали /start в боте, но карточка спрятана гигиеной ФИО. */
    hiddenTelegramBot: number;
  };
  coverage: {
    botOrEmail: number;
    botShare: number | null;
    emailShare: number | null;
  };
  pilotCandidates: number;
  optedOut: { telegram: number; email: number };
  deletedForever: number;
}

/** Индекс качества головы Q_head (0–100) с компонентами. */
export interface HeadQuality {
  score: number;
  band: 'READY' | 'ACTIVATED' | 'WEAK' | 'REACTIVATE';
  bandLabel: string;
  components: {
    artifactQuality: number;
    regularity: number;
    projectInvolvement: number;
    commercialApplicability: number;
  };
}

export interface DuplicateCandidate {
  id: string;
  confidence: number;
  status: string;
  reasons: string[];
  left: PersonSummary;
  right: PersonSummary;
}
