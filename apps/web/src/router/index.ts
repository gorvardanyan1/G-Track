import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
  type RouteRecordSingleView,
} from 'vue-router';
import { useAuthStore } from '../stores/auth.ts';
import { decide, homeFor, type RouteAccess } from './guards.ts';
import { rolesFor } from './navigation.ts';

declare module 'vue-router' {
  interface RouteMeta extends RouteAccess {
    title?: string;
  }
}

const guest = { public: true, guestOnly: true } as const;
/** A menu page: its roles come from the menu, so the two never disagree. */
const page = (
  path: string,
  title: string,
  component: RouteRecordSingleView['component'],
): RouteRecordRaw => ({
  path: path.slice(1),
  component,
  meta: { title, roles: rolesFor(path) },
});

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('../layouts/AuthLayout.vue'),
    children: [
      {
        path: 'login',
        name: 'login',
        component: () => import('../pages/auth/LoginPage.vue'),
        meta: { ...guest, title: 'Sign in' },
      },
      {
        path: 'login/2fa',
        name: 'login-2fa',
        component: () => import('../pages/auth/TwoFactorPage.vue'),
        meta: { ...guest, title: 'Two-factor authentication' },
      },
      {
        path: 'login/2fa-setup',
        name: 'login-2fa-setup',
        component: () => import('../pages/auth/TwoFactorSetupPage.vue'),
        meta: { ...guest, title: 'Set up two-factor authentication' },
      },
      {
        path: 'forgot-password',
        component: () => import('../pages/auth/ForgotPasswordPage.vue'),
        meta: { ...guest, title: 'Forgot password' },
      },
      {
        path: 'reset-password',
        component: () => import('../pages/auth/ResetPasswordPage.vue'),
        meta: { ...guest, title: 'Choose a new password' },
      },
      {
        path: 'accept-invite',
        component: () => import('../pages/auth/AcceptInvitePage.vue'),
        meta: { ...guest, title: 'Join TEMPO' },
      },
    ],
  },
  {
    path: '/',
    component: () => import('../layouts/AppLayout.vue'),
    children: [
      { path: '', name: 'home', redirect: () => homeFor(useAuthStore().role ?? 'WORKER') },
      {
        path: 'today',
        component: () => import('../pages/tracking/TodayPage.vue'),
        meta: { title: 'Today', roles: rolesFor('/today') },
      },
      {
        path: 'week',
        component: () => import('../pages/tracking/WeekPage.vue'),
        meta: { title: 'Timesheet', roles: rolesFor('/week') },
      },
      {
        path: 'calendar',
        component: () => import('../pages/tracking/CalendarPage.vue'),
        meta: { title: 'Calendar', roles: rolesFor('/calendar') },
      },
      {
        path: 'my-reports',
        component: () => import('../pages/tracking/MyReportsPage.vue'),
        meta: { title: 'My reports', roles: rolesFor('/my-reports') },
      },
      {
        path: 'profile',
        component: () => import('../pages/ProfilePage.vue'),
        meta: { title: 'Profile' },
      },
      page('/dashboard', 'Dashboard', () => import('../pages/manage/DashboardPage.vue')),
      page('/projects', 'Projects', () => import('../pages/manage/ProjectsPage.vue')),
      {
        path: 'projects/:id',
        component: () => import('../pages/manage/ProjectDetailPage.vue'),
        meta: { title: 'Project', roles: rolesFor('/projects') },
      },
      page('/approvals', 'Approvals', () => import('../pages/manage/ApprovalsPage.vue')),
      page('/reports', 'Reports', () => import('../pages/manage/ReportsPage.vue')),
      page('/users', 'Users', () => import('../pages/admin/UsersPage.vue')),
      page('/clients', 'Clients & projects', () => import('../pages/admin/ClientsPage.vue')),
      page('/audit-log', 'Audit log', () => import('../pages/admin/AuditLogPage.vue')),
      page('/settings', 'Settings', () => import('../pages/admin/SettingsPage.vue')),
      {
        path: ':pathMatch(.*)*',
        name: 'not-found',
        component: () => import('../pages/NotFoundPage.vue'),
        meta: { title: 'Not found' },
      },
    ],
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  await auth.bootstrap();
  const decision = decide(to.meta, { status: auth.status, role: auth.role }, to.fullPath);
  if (decision.kind === 'redirect')
    return { path: decision.to, ...(decision.query && { query: decision.query }) };
  if (decision.kind === 'not-found') {
    return {
      name: 'not-found',
      params: { pathMatch: to.path.slice(1).split('/') },
      query: to.query,
      hash: to.hash,
      replace: true,
    };
  }
  return true;
});

router.afterEach((to) => {
  if (typeof document !== 'undefined' && to.meta.title) document.title = `${to.meta.title} · TEMPO`;
});
