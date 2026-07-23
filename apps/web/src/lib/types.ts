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
  isPrimary: boolean;
}

export interface PersonSummary {
  id: string;
  canonicalFullName: string;
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
}

export interface ArtifactSummary {
  id: string;
  title: string;
  typeName: string;
  eventId?: string | null;
  status: string;
  latestVersionId?: string | null;
  latestVersionNumber?: number | null;
  latestVersionStatus?: string | null;
  submittedAt?: string | null;
  score?: number | null;
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
  participantCount: number;
  artifactCount: number;
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
  participants: EventParticipantSummary[];
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

export interface TaskSummary {
  id: string;
  title: string;
  status: 'OPEN' | 'DONE' | 'CANCELLED';
  dueAt?: string | null;
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
  | 'COMMERCIAL'
  | 'GRANT_FUND'
  | 'UNIVERSITY'
  | 'GOVERNMENT'
  | 'MEDIA'
  | 'OTHER';
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
}

export interface FpfMetrics {
  flow: {
    revenueTotal: number;
    revenue90d: number;
    wonDeals: number;
    wonDeals90d: number;
    averageCheck: number;
    revenuePerHead: number;
    grantRevenue: number;
    commercialRevenue: number;
    openPipeline: number;
    openDeals: number;
  };
  investments: {
    basePeople: number;
    activated: number;
    activationRate: number;
    churned: number;
    churnRate: number;
    newPeople30d: number;
    artifactAuthors90d: number;
  };
  processes: {
    partnersTotal: number;
    partnersActive: number;
    partnersTouched30d: number;
    activeAgreements: number;
    productsTotal: number;
    productsOnSale: number;
    productsClosed: number;
    eventsTotal: number;
    eventsUpcoming: number;
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
