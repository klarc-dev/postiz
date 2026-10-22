import {
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  registerDecorator,
  ValidateNested,
  ValidateIf,
  ValidationOptions,
} from 'class-validator';
import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';
import { Type } from 'class-transformer';
import { JSONSchema } from 'class-validator-jsonschema';

/** Destination metadata only. Current values are read representations, not write payloads. */
export interface WordpressVoxelField {
  key: string;
  type: string;
  label: string;
  required: boolean;
  description?: string;
  placeholder?: string;
  choices?: { value: string; label: string }[];
  maxlength?: number;
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  children?: WordpressVoxelField[];
}

export interface WordpressVoxelSchema {
  supported: boolean;
  type: string;
  postType: string;
  fields: WordpressVoxelField[];
  configStatus: 'loaded' | 'forbidden' | 'not_requested';
  valuesStatus: 'loaded' | 'not_requested';
  values?: Record<string, unknown>;
}

// Limits mirror the receiving WordPress adapter (64 KiB decoded payload, 16
// levels of JSON nesting) so Postiz rejects what WordPress would reject.
export const WORDPRESS_VOXEL_FIELDS_MAX_BYTES = 65536;
export const WORDPRESS_VOXEL_FIELDS_MAX_DEPTH = 16;
export const WORDPRESS_VOXEL_FIELDS_MAX_KEYS = 200;
const VOXEL_FIELD_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Returns why a voxel_fields value is unsafe, or undefined when it is safe. */
export function voxelFieldsProblem(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'voxel_fields must be a JSON object keyed by Voxel field key';
  }
  const top = Object.keys(value as object);
  if (top.length > WORDPRESS_VOXEL_FIELDS_MAX_KEYS) {
    return `voxel_fields accepts at most ${WORDPRESS_VOXEL_FIELDS_MAX_KEYS} fields`;
  }
  const badKey = top.find((key) => !VOXEL_FIELD_KEY.test(key));
  if (badKey !== undefined) {
    return `voxel_fields key "${badKey}" is not a valid Voxel field key`;
  }
  const walk = (node: unknown, depth: number): string | undefined => {
    if (depth > WORDPRESS_VOXEL_FIELDS_MAX_DEPTH) {
      return `voxel_fields is nested deeper than ${WORDPRESS_VOXEL_FIELDS_MAX_DEPTH} levels`;
    }
    if (node === null || ['string', 'boolean'].includes(typeof node)) {
      return undefined;
    }
    if (typeof node === 'number') {
      return Number.isFinite(node)
        ? undefined
        : 'voxel_fields contains a non-finite number';
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        const problem = walk(item, depth + 1);
        if (problem) return problem;
      }
      return undefined;
    }
    if (typeof node === 'object') {
      const proto = Object.getPrototypeOf(node);
      if (proto !== Object.prototype && proto !== null) {
        return 'voxel_fields may only contain plain JSON values';
      }
      for (const key of Object.keys(node as object)) {
        if (FORBIDDEN_KEYS.has(key)) {
          return `voxel_fields contains the forbidden key "${key}"`;
        }
        const problem = walk((node as Record<string, unknown>)[key], depth + 1);
        if (problem) return problem;
      }
      return undefined;
    }
    return 'voxel_fields may only contain JSON values';
  };
  const problem = walk(value, 1);
  if (problem) {
    return problem;
  }
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (bytes > WORDPRESS_VOXEL_FIELDS_MAX_BYTES) {
    return `voxel_fields is ${bytes} bytes, above the ${WORDPRESS_VOXEL_FIELDS_MAX_BYTES} byte limit`;
  }
  return undefined;
}

function IsSafeVoxelFields(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isSafeVoxelFields',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => voxelFieldsProblem(value) === undefined,
        defaultMessage: (args) =>
          voxelFieldsProblem(args?.value) || 'invalid voxel_fields',
      },
    });
  };
}

export class WordpressDto {
  @IsString()
  @MinLength(2)
  @IsDefined()
  title: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  main_image?: MediaDto;

  @IsString()
  @IsDefined()
  @Matches(/^[a-z0-9_-]+$/i, { message: 'type must be a REST base' })
  type: string;

  @ValidateIf((object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  @JSONSchema({
    description:
      'Explicit WordPress post id to update within the selected REST type. Omit to create a new post.',
  })
  existing_post_id?: number;

  @ValidateIf((object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  @JSONSchema({
    description:
      'Native WordPress parent post id for hierarchical post types. Must be positive; omit to preserve the current parent.',
  })
  parent?: number;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  categories?: number[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  tags?: number[];

  @IsOptional()
  @IsString()
  @IsIn(['publish', 'draft', 'pending', 'private'])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @JSONSchema({
    description:
      'Native WordPress excerpt. Sent as-is when present; the site may enforce its own length rules.',
  })
  excerpt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase letters, digits and single hyphens',
  })
  @JSONSchema({
    description:
      'Explicit post slug. Replaces the generated slug on create. Omit on update to preserve the existing slug.',
  })
  slug?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @JSONSchema({
    description:
      'WordPress user id of the author (authorsList tool). WordPress still enforces the connected user capabilities.',
  })
  author?: number;

  @IsOptional()
  @IsSafeVoxelFields()
  @JSONSchema({
    type: 'object',
    description:
      'Voxel custom field values keyed by field key (sites running the Voxel addon). Use voxelFieldsSample to see the site keys and shapes. Sent as the native voxel_fields REST property.',
  })
  voxel_fields?: Record<string, unknown>;
}
