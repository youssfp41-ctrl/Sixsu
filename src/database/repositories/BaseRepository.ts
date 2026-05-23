import { Model, Document } from "mongoose";
import type { QueryFilter, UpdateQuery } from "mongoose";
import { IRepository } from "../interfaces/IRepository";

export abstract class BaseRepository<
  T extends Document,
  CreateDTO = Partial<T>,
  UpdateDTO = Partial<T>
> implements IRepository<T, CreateDTO, UpdateDTO>
{
  protected readonly model: Model<T>;

  constructor(model: Model<T>) {
    this.model = model;
  }

  async findById(id: string): Promise<T | null> {
    try {
      return await this.model.findById(id).exec();
    } catch (err) {
      throw this.wrap("findById", err);
    }
  }

  async findOne(filter: QueryFilter<T>): Promise<T | null> {
    try {
      return await this.model.findOne(filter).exec();
    } catch (err) {
      throw this.wrap("findOne", err);
    }
  }

  async findMany(filter: QueryFilter<T> = {}, limit?: number): Promise<T[]> {
    try {
      const query = this.model.find(filter);
      if (limit !== undefined) query.limit(limit);
      return await query.exec();
    } catch (err) {
      throw this.wrap("findMany", err);
    }
  }

  async create(data: CreateDTO): Promise<T> {
    try {
      const doc = new this.model(data);
      return (await doc.save()) as T;
    } catch (err) {
      throw this.wrap("create", err);
    }
  }

  async updateById(id: string, data: UpdateDTO): Promise<T | null> {
    try {
      return await this.model
        .findByIdAndUpdate(id, { $set: data } as UpdateQuery<T>, {
          new: true,
          runValidators: true,
        })
        .exec();
    } catch (err) {
      throw this.wrap("updateById", err);
    }
  }

  async deleteById(id: string): Promise<boolean> {
    try {
      const result = await this.model.findByIdAndDelete(id).exec();
      return result !== null;
    } catch (err) {
      throw this.wrap("deleteById", err);
    }
  }

  async exists(filter: QueryFilter<T>): Promise<boolean> {
    try {
      const result = await this.model.exists(filter).exec();
      return result !== null;
    } catch (err) {
      throw this.wrap("exists", err);
    }
  }

  async count(filter: QueryFilter<T> = {}): Promise<number> {
    try {
      return await this.model.countDocuments(filter).exec();
    } catch (err) {
      throw this.wrap("count", err);
    }
  }

  private wrap(method: string, err: unknown): Error {
    const name = this.model.modelName;
    const msg = err instanceof Error ? err.message : String(err);
    return new Error(`[${name}Repository.${method}] ${msg}`);
  }
}
