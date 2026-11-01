// Static demo data. Emails use the reserved .test TLD.

export interface SeedUser {
  key: string;
  email: string;
  name: string;
  role: 'SUPER_ADMIN' | 'PROJECT_MANAGER' | 'WORKER';
  timezone: string;
}

export interface SeedWorkerProfile {
  /** Earliest/latest local start of the working day, minutes after midnight. */
  dayStartMinutes: [number, number];
  /** Probability that a workday ends with a late session crossing local midnight. */
  lateNightChance: number;
  /** Whether the worker has a timer running when the seed finishes. */
  runningNow: boolean;
}

export const USERS: readonly SeedUser[] = [
  {
    key: 'admin',
    email: 'admin@tempo.test',
    name: 'Ada Sargsyan',
    role: 'SUPER_ADMIN',
    timezone: 'Asia/Yerevan',
  },
  {
    key: 'pmBerlin',
    email: 'petra.neumann@tempo.test',
    name: 'Petra Neumann',
    role: 'PROJECT_MANAGER',
    timezone: 'Europe/Berlin',
  },
  {
    key: 'pmNewYork',
    email: 'marcus.reed@tempo.test',
    name: 'Marcus Reed',
    role: 'PROJECT_MANAGER',
    timezone: 'America/New_York',
  },
  {
    key: 'anahit',
    email: 'anahit.petrosyan@tempo.test',
    name: 'Anahit Petrosyan',
    role: 'WORKER',
    timezone: 'Asia/Yerevan',
  },
  {
    key: 'davit',
    email: 'davit.grigoryan@tempo.test',
    name: 'Davit Grigoryan',
    role: 'WORKER',
    timezone: 'Asia/Yerevan',
  },
  {
    key: 'lena',
    email: 'lena.fischer@tempo.test',
    name: 'Lena Fischer',
    role: 'WORKER',
    timezone: 'Europe/Berlin',
  },
  {
    key: 'jonas',
    email: 'jonas.weber@tempo.test',
    name: 'Jonas Weber',
    role: 'WORKER',
    timezone: 'Europe/Berlin',
  },
  {
    key: 'sofia',
    email: 'sofia.martinez@tempo.test',
    name: 'Sofia Martinez',
    role: 'WORKER',
    timezone: 'America/New_York',
  },
  {
    key: 'ethan',
    email: 'ethan.brooks@tempo.test',
    name: 'Ethan Brooks',
    role: 'WORKER',
    timezone: 'America/New_York',
  },
];

export const WORKER_PROFILES: Readonly<Record<string, SeedWorkerProfile>> = {
  anahit: { dayStartMinutes: [9 * 60, 10 * 60], lateNightChance: 0.05, runningNow: true },
  davit: { dayStartMinutes: [10 * 60, 11 * 60 + 30], lateNightChance: 0.3, runningNow: false },
  lena: { dayStartMinutes: [8 * 60, 9 * 60], lateNightChance: 0, runningNow: true },
  jonas: { dayStartMinutes: [8 * 60 + 30, 9 * 60 + 30], lateNightChance: 0.1, runningNow: false },
  sofia: { dayStartMinutes: [8 * 60 + 30, 9 * 60 + 30], lateNightChance: 0.05, runningNow: true },
  ethan: { dayStartMinutes: [9 * 60 + 30, 11 * 60], lateNightChance: 0.35, runningNow: false },
};

export const CLIENTS = [
  { key: 'northwind', name: 'Northwind Logistics' },
  { key: 'aurora', name: 'Aurora Health' },
] as const;

export interface SeedProject {
  key: string;
  clientKey: (typeof CLIENTS)[number]['key'];
  name: string;
  color: string;
  budgetHours: number | null;
  isBillable: boolean;
  pmKey: string;
  workerKeys: readonly string[];
  hourlyRate: number;
  /** Task name → typical descriptions of the work. */
  tasks: Readonly<Record<string, readonly string[]>>;
}

export const PROJECTS: readonly SeedProject[] = [
  {
    key: 'fleet',
    clientKey: 'northwind',
    name: 'Fleet Dashboard',
    color: '#5B5BF7',
    budgetHours: 600,
    isBillable: true,
    pmKey: 'pmBerlin',
    workerKeys: ['anahit', 'lena', 'jonas'],
    hourlyRate: 85,
    tasks: {
      'Live map': ['Vehicle clustering on map', 'Map tile caching', 'Realtime position updates'],
      'Alerts & notifications': [
        'Geofence alert rules',
        'Email digest for alerts',
        'Alert settings UI',
      ],
      'Design review': ['Review dashboard mockups', 'Accessibility pass on charts'],
      'Bug fixing': [
        'Fix timezone label in trip list',
        'Fix chart tooltip overflow',
        'Triage QA findings',
      ],
    },
  },
  {
    key: 'routes',
    clientKey: 'northwind',
    name: 'Route Optimizer API',
    color: '#0EA5E9',
    budgetHours: 400,
    isBillable: true,
    pmKey: 'pmNewYork',
    workerKeys: ['davit', 'sofia', 'ethan'],
    hourlyRate: 95,
    tasks: {
      'Solver integration': [
        'Tune VRP solver constraints',
        'Benchmark solver runs',
        'Handle infeasible routes',
      ],
      'Public API': [
        'Rate limiting for partner keys',
        'OpenAPI docs update',
        'Pagination for route history',
      ],
      'Load testing': ['k6 scenario for peak hours', 'Analyze p99 latency'],
    },
  },
  {
    key: 'portal',
    clientKey: 'aurora',
    name: 'Patient Portal',
    color: '#10B981',
    budgetHours: 800,
    isBillable: true,
    pmKey: 'pmNewYork',
    workerKeys: ['anahit', 'davit', 'jonas', 'sofia'],
    hourlyRate: 90,
    tasks: {
      Appointments: ['Booking flow', 'Reschedule & cancel', 'Calendar sync'],
      Messaging: ['Secure messaging threads', 'Attachment virus scanning'],
      Compliance: ['HIPAA audit log review', 'Data retention job'],
      QA: ['Regression test run', 'E2E tests for booking'],
    },
  },
  {
    key: 'mobile',
    clientKey: 'aurora',
    name: 'Care Mobile App',
    color: '#F59E0B',
    budgetHours: null,
    isBillable: false,
    pmKey: 'pmBerlin',
    workerKeys: ['lena', 'ethan', 'davit'],
    hourlyRate: 80,
    tasks: {
      Onboarding: ['Onboarding screens', 'Push permission prompt'],
      'Offline mode': ['Sync queue', 'Conflict resolution for offline edits'],
      Release: ['App store screenshots', 'Release notes', 'TestFlight build'],
    },
  },
];
