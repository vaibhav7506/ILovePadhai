export type ExaminationStatus = 'available' | 'verification';

export interface Examination {
  readonly slug: string;
  readonly shortName: string;
  readonly fullName: string;
  readonly level: 'secondary' | 'graduate';
  readonly status: ExaminationStatus;
}

export const examinations: readonly Examination[] = [
  {
    slug: 'ssc-mts',
    shortName: 'SSC MTS',
    fullName: 'Multi-Tasking (Non-Technical) Staff',
    level: 'secondary',
    status: 'verification',
  },
  {
    slug: 'ssc-gd',
    shortName: 'SSC GD Constable',
    fullName: 'General Duty Constable',
    level: 'secondary',
    status: 'verification',
  },
  {
    slug: 'ssc-chsl',
    shortName: 'SSC CHSL',
    fullName: 'Combined Higher Secondary Level',
    level: 'secondary',
    status: 'verification',
  },
  {
    slug: 'ssc-cgl',
    shortName: 'SSC CGL',
    fullName: 'Combined Graduate Level',
    level: 'graduate',
    status: 'verification',
  },
  {
    slug: 'ssc-cpo',
    shortName: 'SSC CPO',
    fullName: 'Central Police Organisation',
    level: 'graduate',
    status: 'verification',
  },
  {
    slug: 'rrb-ntpc-graduate',
    shortName: 'RRB NTPC Graduate',
    fullName: 'Non-Technical Popular Categories',
    level: 'graduate',
    status: 'verification',
  },
] as const;
