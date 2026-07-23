import { Type, type Static } from '@sinclair/typebox';

export const Uuid = Type.String({ format: 'uuid' });
export const IsoDateTime = Type.String({ format: 'date-time' });

export const ProblemDetails = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Integer(),
  detail: Type.Optional(Type.String()),
  instance: Type.Optional(Type.String()),
  requestId: Type.Optional(Type.String()),
});

export const ActivityStatus = Type.Union([
  Type.Literal('UNKNOWN'),
  Type.Literal('ACTIVE'),
  Type.Literal('MEDIUM'),
  Type.Literal('INACTIVE'),
]);

export const ActivationState = Type.Union([
  Type.Literal('UNKNOWN_LEGACY'),
  Type.Literal('NOT_ACTIVATED'),
  Type.Literal('ACTIVATED'),
]);

export const ContactInput = Type.Object({
  type: Type.Union([
    Type.Literal('EMAIL'),
    Type.Literal('PHONE'),
    Type.Literal('TELEGRAM'),
    Type.Literal('MAX'),
    Type.Literal('OTHER'),
  ]),
  value: Type.String({ minLength: 1, maxLength: 500 }),
  isPrimary: Type.Optional(Type.Boolean()),
});

export const CreatePersonBody = Type.Object({
  canonicalFullName: Type.String({ minLength: 2, maxLength: 500 }),
  lifecycleDataState: Type.Optional(
    Type.Union([Type.Literal('LEGACY_INCOMPLETE'), Type.Literal('COMPLETE')]),
  ),
  contacts: Type.Optional(Type.Array(ContactInput, { maxItems: 20 })),
  organization: Type.Optional(Type.String({ maxLength: 500 })),
  faculty: Type.Optional(Type.String({ maxLength: 500 })),
});

export const PatchPersonContactInput = Type.Object({
  id: Type.Optional(Uuid),
  type: Type.Union([
    Type.Literal('EMAIL'),
    Type.Literal('PHONE'),
    Type.Literal('TELEGRAM'),
    Type.Literal('MAX'),
    Type.Literal('OTHER'),
  ]),
  value: Type.String({ minLength: 1, maxLength: 500 }),
  isPrimary: Type.Optional(Type.Boolean()),
  archive: Type.Optional(Type.Boolean()),
});

export const PatchPersonBody = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  canonicalFullName: Type.Optional(Type.String({ minLength: 2, maxLength: 500 })),
  ownerUserId: Type.Optional(Type.Union([Uuid, Type.Null()])),
  organization: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
  faculty: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
  roleTitle: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
  contacts: Type.Optional(Type.Array(PatchPersonContactInput, { maxItems: 20 })),
});

export const EventStatus = Type.Union([
  Type.Literal('PLANNED'),
  Type.Literal('ACTIVE'),
  Type.Literal('COMPLETED'),
  Type.Literal('CANCELLED'),
]);

export const CreateEventBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 500 }),
    status: Type.Optional(EventStatus),
    startsAt: Type.Optional(IsoDateTime),
    endsAt: Type.Optional(IsoDateTime),
    programId: Type.Optional(Uuid),
    participantIds: Type.Optional(Type.Array(Uuid, { maxItems: 1_000, uniqueItems: true })),
  },
  { additionalProperties: false },
);

export const CreateArtifactBody = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 500 }),
  typeCode: Type.String({ minLength: 1, maxLength: 100 }),
  description: Type.Optional(Type.String({ maxLength: 10_000 })),
  eventId: Type.Optional(Uuid),
});

export const ArtifactContributorInput = Type.Object({
  personId: Uuid,
  role: Type.Union([Type.Literal('AUTHOR'), Type.Literal('CONTRIBUTOR')]),
  description: Type.Optional(Type.String({ maxLength: 2_000 })),
});

export const CreateArtifactVersionBody = Type.Object({
  contentType: Type.Union([
    Type.Literal('FILE'),
    Type.Literal('EXTERNAL_URL'),
    Type.Literal('TEXT'),
    Type.Literal('MIXED'),
  ]),
  textContent: Type.Optional(Type.String({ maxLength: 500_000 })),
  externalUrls: Type.Optional(Type.Array(Type.String({ format: 'uri' }), { maxItems: 20 })),
  fileObjectIds: Type.Optional(Type.Array(Uuid, { maxItems: 20 })),
  contributors: Type.Array(ArtifactContributorInput, { minItems: 1, maxItems: 100 }),
});

export const SubmitArtifactVersionBody = Type.Object({
  submittedAt: Type.Optional(IsoDateTime),
  backdateReason: Type.Optional(Type.String({ minLength: 3, maxLength: 2_000 })),
});

export const ReviewArtifactVersionBody = Type.Object({
  score: Type.Integer({ minimum: 1, maximum: 10 }),
  decision: Type.Union([
    Type.Literal('NEEDS_REVISION'),
    Type.Literal('ACCEPTED'),
    Type.Literal('REJECTED'),
  ]),
  comment: Type.Optional(Type.String({ maxLength: 10_000 })),
});

export const PartnerKind = Type.Union([
  Type.Literal('COMMERCIAL'),
  Type.Literal('GRANT_FUND'),
  Type.Literal('UNIVERSITY'),
  Type.Literal('GOVERNMENT'),
  Type.Literal('MEDIA'),
  Type.Literal('OTHER'),
]);

export const PartnerStatus = Type.Union([
  Type.Literal('PROSPECT'),
  Type.Literal('DEVELOPING'),
  Type.Literal('ACTIVE'),
  Type.Literal('PAUSED'),
  Type.Literal('CLOSED'),
]);

export const CreatePartnerBody = Type.Object(
  {
    name: Type.String({ minLength: 2, maxLength: 500 }),
    kind: Type.Optional(PartnerKind),
    status: Type.Optional(PartnerStatus),
    inn: Type.Optional(Type.String({ maxLength: 20 })),
    website: Type.Optional(Type.String({ maxLength: 1000 })),
    notes: Type.Optional(Type.String({ maxLength: 10_000 })),
  },
  { additionalProperties: false },
);

export const PatchPartnerBody = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    name: Type.Optional(Type.String({ minLength: 2, maxLength: 500 })),
    kind: Type.Optional(PartnerKind),
    status: Type.Optional(PartnerStatus),
    inn: Type.Optional(Type.Union([Type.String({ maxLength: 20 }), Type.Null()])),
    website: Type.Optional(Type.Union([Type.String({ maxLength: 1000 }), Type.Null()])),
    notes: Type.Optional(Type.Union([Type.String({ maxLength: 10_000 }), Type.Null()])),
  },
  { additionalProperties: false },
);

export const CreatePartnerContactBody = Type.Object(
  {
    fullName: Type.String({ minLength: 2, maxLength: 500 }),
    position: Type.Optional(Type.String({ maxLength: 500 })),
    isDecisionMaker: Type.Optional(Type.Boolean()),
    email: Type.Optional(Type.String({ maxLength: 500 })),
    phone: Type.Optional(Type.String({ maxLength: 100 })),
    telegram: Type.Optional(Type.String({ maxLength: 100 })),
    notes: Type.Optional(Type.String({ maxLength: 10_000 })),
  },
  { additionalProperties: false },
);

export const PartnerAgreementType = Type.Union([
  Type.Literal('GRANT'),
  Type.Literal('COMMERCIAL'),
  Type.Literal('PARTNERSHIP'),
  Type.Literal('INFO_PARTNERSHIP'),
]);

export const PartnerAgreementStatus = Type.Union([
  Type.Literal('DRAFT'),
  Type.Literal('NEGOTIATION'),
  Type.Literal('ACTIVE'),
  Type.Literal('COMPLETED'),
  Type.Literal('TERMINATED'),
]);

export const CreatePartnerAgreementBody = Type.Object(
  {
    title: Type.String({ minLength: 2, maxLength: 500 }),
    agreementType: PartnerAgreementType,
    status: Type.Optional(PartnerAgreementStatus),
    amount: Type.Optional(Type.Number({ minimum: 0, maximum: 1e12 })),
    signedAt: Type.Optional(IsoDateTime),
    startsAt: Type.Optional(IsoDateTime),
    endsAt: Type.Optional(IsoDateTime),
    comment: Type.Optional(Type.String({ maxLength: 10_000 })),
  },
  { additionalProperties: false },
);

export const PatchPartnerAgreementBody = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    status: Type.Optional(PartnerAgreementStatus),
    amount: Type.Optional(Type.Union([Type.Number({ minimum: 0, maximum: 1e12 }), Type.Null()])),
    comment: Type.Optional(Type.Union([Type.String({ maxLength: 10_000 }), Type.Null()])),
  },
  { additionalProperties: false },
);

export const CreatePartnerInteractionBody = Type.Object(
  {
    contactId: Type.Optional(Uuid),
    channel: Type.Union([
      Type.Literal('EMAIL'),
      Type.Literal('PHONE'),
      Type.Literal('TELEGRAM'),
      Type.Literal('MAX'),
      Type.Literal('IN_PERSON'),
      Type.Literal('OTHER'),
    ]),
    direction: Type.Union([
      Type.Literal('INBOUND'),
      Type.Literal('OUTBOUND'),
      Type.Literal('INTERNAL'),
    ]),
    occurredAt: IsoDateTime,
    outcome: Type.Optional(Type.String({ maxLength: 2000 })),
    comment: Type.Optional(Type.String({ maxLength: 10_000 })),
  },
  { additionalProperties: false },
);

export const ProductStatus = Type.Union([
  Type.Literal('IDEA'),
  Type.Literal('PACKAGING'),
  Type.Literal('ON_SALE'),
  Type.Literal('CLOSED'),
]);

export const CreateProductBody = Type.Object(
  {
    name: Type.String({ minLength: 2, maxLength: 500 }),
    description: Type.Optional(Type.String({ maxLength: 10_000 })),
    deliveryModel: Type.Optional(Type.String({ maxLength: 2000 })),
    documentationUrl: Type.Optional(Type.String({ maxLength: 1000 })),
    status: Type.Optional(
      Type.Union([Type.Literal('IDEA'), Type.Literal('PACKAGING'), Type.Literal('ON_SALE')]),
    ),
    price: Type.Optional(Type.Number({ minimum: 0, maximum: 1e12 })),
  },
  { additionalProperties: false },
);

export const PatchProductBody = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    name: Type.Optional(Type.String({ minLength: 2, maxLength: 500 })),
    description: Type.Optional(Type.Union([Type.String({ maxLength: 10_000 }), Type.Null()])),
    deliveryModel: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
    documentationUrl: Type.Optional(Type.Union([Type.String({ maxLength: 1000 }), Type.Null()])),
    status: Type.Optional(ProductStatus),
    price: Type.Optional(Type.Union([Type.Number({ minimum: 0, maximum: 1e12 }), Type.Null()])),
    closeReason: Type.Optional(Type.String({ minLength: 3, maxLength: 2000 })),
  },
  { additionalProperties: false },
);

export const DealType = Type.Union([Type.Literal('GRANT'), Type.Literal('COMMERCIAL')]);

export const DealStatus = Type.Union([
  Type.Literal('LEAD'),
  Type.Literal('NEGOTIATION'),
  Type.Literal('WON'),
  Type.Literal('LOST'),
]);

export const CreateDealBody = Type.Object(
  {
    title: Type.String({ minLength: 2, maxLength: 500 }),
    dealType: DealType,
    status: Type.Optional(DealStatus),
    amount: Type.Number({ minimum: 0, maximum: 1e12 }),
    partnerId: Type.Optional(Uuid),
    agreementId: Type.Optional(Uuid),
    productId: Type.Optional(Uuid),
    projectId: Type.Optional(Uuid),
    expectedCloseAt: Type.Optional(IsoDateTime),
    comment: Type.Optional(Type.String({ maxLength: 10_000 })),
  },
  { additionalProperties: false },
);

export const PatchDealBody = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    title: Type.Optional(Type.String({ minLength: 2, maxLength: 500 })),
    status: Type.Optional(DealStatus),
    amount: Type.Optional(Type.Number({ minimum: 0, maximum: 1e12 })),
    expectedCloseAt: Type.Optional(Type.Union([IsoDateTime, Type.Null()])),
    comment: Type.Optional(Type.Union([Type.String({ maxLength: 10_000 }), Type.Null()])),
  },
  { additionalProperties: false },
);

export type CreatePersonInput = Static<typeof CreatePersonBody>;
export type PatchPersonInput = Static<typeof PatchPersonBody>;
export type CreateEventInput = Static<typeof CreateEventBody>;
export type CreateArtifactInput = Static<typeof CreateArtifactBody>;
export type CreateArtifactVersionInput = Static<typeof CreateArtifactVersionBody>;
export type SubmitArtifactVersionInput = Static<typeof SubmitArtifactVersionBody>;
export type ReviewArtifactVersionInput = Static<typeof ReviewArtifactVersionBody>;
export type CreatePartnerInput = Static<typeof CreatePartnerBody>;
export type PatchPartnerInput = Static<typeof PatchPartnerBody>;
export type CreatePartnerContactInput = Static<typeof CreatePartnerContactBody>;
export type CreatePartnerAgreementInput = Static<typeof CreatePartnerAgreementBody>;
export type PatchPartnerAgreementInput = Static<typeof PatchPartnerAgreementBody>;
export type CreatePartnerInteractionInput = Static<typeof CreatePartnerInteractionBody>;
export type CreateProductInput = Static<typeof CreateProductBody>;
export type PatchProductInput = Static<typeof PatchProductBody>;
export type CreateDealInput = Static<typeof CreateDealBody>;
export type PatchDealInput = Static<typeof PatchDealBody>;
