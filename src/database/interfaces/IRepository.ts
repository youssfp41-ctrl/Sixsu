import type { QueryFilter } from "mongoose";

export interface IRepository<T, CreateDTO = Partial<T>, UpdateDTO = Partial<T>> {
  findById(id: string): Promise<T | null>;
  findOne(filter: QueryFilter<T>): Promise<T | null>;
  findMany(filter?: QueryFilter<T>, limit?: number): Promise<T[]>;
  create(data: CreateDTO): Promise<T>;
  updateById(id: string, data: UpdateDTO): Promise<T | null>;
  deleteById(id: string): Promise<boolean>;
  exists(filter: QueryFilter<T>): Promise<boolean>;
  count(filter?: QueryFilter<T>): Promise<number>;
}
