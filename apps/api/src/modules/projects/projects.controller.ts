import type { RequestHandler } from 'express';
import type {
  CreateProjectRequest,
  CreateTaskRequest,
  ListProjectsQuery,
  MemberParams,
  TaskParams,
  UpdateProjectRequest,
  UpdateTaskRequest,
  UpsertMemberRequest,
} from '@tempo/shared';
import { requestContext } from '../../lib/request-context.ts';
import { validatedBody, validatedParams, validatedQuery } from '../../middleware/validate.ts';
import { requireAuth } from '../auth/auth.http.ts';
import type { MembersService } from './members.service.ts';
import type { ProjectUsageService } from './project-usage.service.ts';
import {
  toCandidateResponse,
  toMemberResponse,
  toProjectResponse,
  toTaskResponse,
} from './projects.mappers.ts';
import type { ProjectsService } from './projects.service.ts';
import type { TasksService } from './tasks.service.ts';

type IdParams = { id: string };

export function createProjectsController(services: {
  projects: ProjectsService;
  members: MembersService;
  tasks: TasksService;
  usage: ProjectUsageService;
}) {
  const { projects, members, tasks, usage } = services;
  const id = (req: Parameters<RequestHandler>[0]) => validatedParams<IdParams>(req).id;

  return {
    list: (async (req, res) => {
      const { includeArchived } = validatedQuery<ListProjectsQuery>(req);
      res.json((await projects.list(requireAuth(req), includeArchived)).map(toProjectResponse));
    }) satisfies RequestHandler,

    usage: (async (req, res) => {
      res.json(await usage.list(requireAuth(req)));
    }) satisfies RequestHandler,

    projectUsage: (async (req, res) => {
      res.json(await usage.get(requireAuth(req), id(req)));
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      res.json(toProjectResponse(await projects.get(requireAuth(req), id(req))));
    }) satisfies RequestHandler,

    create: (async (req, res) => {
      const project = await projects.create(
        requireAuth(req),
        validatedBody<CreateProjectRequest>(req),
        requestContext(req),
      );
      res.status(201).json(toProjectResponse(project));
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const project = await projects.update(
        requireAuth(req),
        id(req),
        validatedBody<UpdateProjectRequest>(req),
        requestContext(req),
      );
      res.json(toProjectResponse(project));
    }) satisfies RequestHandler,

    archive: (async (req, res) => {
      res.json(
        toProjectResponse(
          await projects.setArchived(requireAuth(req), id(req), true, requestContext(req)),
        ),
      );
    }) satisfies RequestHandler,

    unarchive: (async (req, res) => {
      res.json(
        toProjectResponse(
          await projects.setArchived(requireAuth(req), id(req), false, requestContext(req)),
        ),
      );
    }) satisfies RequestHandler,

    listMembers: (async (req, res) => {
      res.json((await members.list(requireAuth(req), id(req))).map(toMemberResponse));
    }) satisfies RequestHandler,

    memberCandidates: (async (req, res) => {
      res.json((await members.candidates(requireAuth(req), id(req))).map(toCandidateResponse));
    }) satisfies RequestHandler,

    upsertMember: (async (req, res) => {
      const params = validatedParams<MemberParams>(req);
      const member = await members.upsert(
        requireAuth(req),
        params.id,
        params.userId,
        validatedBody<UpsertMemberRequest>(req),
        requestContext(req),
      );
      res.json(toMemberResponse(member));
    }) satisfies RequestHandler,

    removeMember: (async (req, res) => {
      const params = validatedParams<MemberParams>(req);
      await members.remove(requireAuth(req), params.id, params.userId, requestContext(req));
      res.status(204).end();
    }) satisfies RequestHandler,

    listTasks: (async (req, res) => {
      res.json((await tasks.list(requireAuth(req), id(req))).map(toTaskResponse));
    }) satisfies RequestHandler,

    createTask: (async (req, res) => {
      const { name } = validatedBody<CreateTaskRequest>(req);
      res
        .status(201)
        .json(
          toTaskResponse(await tasks.create(requireAuth(req), id(req), name, requestContext(req))),
        );
    }) satisfies RequestHandler,

    updateTask: (async (req, res) => {
      const params = validatedParams<TaskParams>(req);
      const task = await tasks.update(
        requireAuth(req),
        params.id,
        params.taskId,
        validatedBody<UpdateTaskRequest>(req),
        requestContext(req),
      );
      res.json(toTaskResponse(task));
    }) satisfies RequestHandler,

    deleteTask: (async (req, res) => {
      const params = validatedParams<TaskParams>(req);
      await tasks.remove(requireAuth(req), params.id, params.taskId, requestContext(req));
      res.status(204).end();
    }) satisfies RequestHandler,
  };
}
