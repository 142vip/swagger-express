import doctrineFile from 'doctrine-file';
import fs from 'fs';
import glob from 'glob';
import path from 'express-swaggerize-ui/static/swagger-ui';
import swaggerUIExpress from 'swagger-ui-express';
import swaggerParse from 'swagger-parser';
import parseSwaggerUtil from './parse-swagger-util';

/**
 * 解析router
 * @param str
 */
function parseRoute(str) {
  const split = str.split(' ');

  return {
    method: split[0].toLowerCase() || 'get',
    uri: split[1] || ''
  };
}

function parseField(str) {
  const split = str.split('.');
  return {
    name: split[0],
    parameter_type: split[1] || 'get',
    required: (split[2] && split[2] === 'required') || false
  };
}

function parseType(obj) {
  if (!obj) return undefined;
  if (obj.name) {
    const spl = obj.name.split('.');
    if (spl.length > 1 && spl[1] === 'model') {
      return spl[0];
    }
    return obj.name;
  }
  if (obj.expression && obj.expression.name) {
    return obj.expression.name.toLowerCase();
  }
  return 'string';
}

function parseSchema(obj) {
  if (!(obj.name || obj.applications)) return undefined;

  if (obj.name != null) {
    const spl = obj.name.split('.');
    if (spl.length > 1 && spl[1] === 'model') {
      return { $ref: `#/definitions/${spl[0]}` };
    }
    return undefined;
  }
  if (obj.applications != null) {
    if (obj.applications.length === 1) {
      const type = obj.applications[0].name;
      if (
        type === 'object'
        || type === 'string'
        || type === 'integer'
        || type === 'boolean'
      ) {
        return {
          type: obj.expression.name.toLowerCase(),
          items: {
            type
          }
        };
      }
      return {
        type: obj.expression.name.toLowerCase(),
        items: {
          $ref: `#/definitions/${obj.applications[0].name}`
        }
      };
    }
    const oneOf = [];
    for (const i in obj.applications) {
      const type = obj.applications[i].name;
      if (
        type === 'object'
        || type === 'string'
        || type === 'integer'
        || type === 'boolean'
      ) {
        oneOf.push({
          type
        });
      }
      else {
        oneOf.push({
          $ref: `#/definitions/${obj.applications[i].name}`
        });
      }
      return {
        type: obj.expression.name.toLowerCase(),
        items: {
          oneOf
        }
      };
    }
  }

  return undefined;
}

function parseDescription(obj) {
  const description = obj.description || '';
  const sanitizedDescription = description.replace('/**', '');
  return sanitizedDescription;
}

function parseTag(tags) {
  for (const i in tags) {
    if (tags[i].title === 'group') {
      return tags[i].description.split('-');
    }
  }
  return ['default', ''];
}

function parseProduces(str) {
  return str.split(/\s+/);
}

function parseConsumes(str) {
  return str.split(/\s+/);
}

function parseSecurity(comments) {
  let security;
  try {
    security = JSON.parse(comments);
  }
  catch (e) {
    const obj = {};
    obj[comments] = [];
    security = [obj];
  }
  return security;
}

function parseHeaders(comments) {
  const headers = {};
  for (const i in comments) {
    if (comments[i].title === 'headers' || comments[i].title === 'header') {
      const description = comments[i].description.split(/\s+-\s+/);

      if (description.length < 1) {
        break;
      }
      const code2name = description[0].split('.');

      if (code2name.length < 2) {
        break;
      }

      const type = code2name[0].match(/\w+/);
      const code = code2name[0].match(/\d+/);

      if (!type || !code) {
        break;
      }
      const code0 = code[0].trim();
      if (!headers[code0]) {
        headers[code0] = {};
      }

      headers[code0][code2name[1]] = {
        type: type[0],
        description: description[1]
      };
    }
  }
  return headers;
}

/**
 *
 * @param obj
 */
function parseItems(obj) {
  if (
    obj.applications
    && obj.applications.length > 0
    && obj.applications[0].name
  ) {
    const type = obj.applications[0].name;
    if (
      type === 'object'
      || type === 'string'
      || type === 'integer'
      || type === 'boolean'
    ) {
      return { type };
    }
    return { $ref: `#/definitions/${type}` };
  }
  return undefined;
}

/**
 * 解析return字段
 * @param tags
 */
function parseReturn(tags) {
  const rets = {};
  const headers = parseHeaders(tags);

  Object.values(tags).forEach((tag) => {
    if (tag.title === 'returns' || tag.title === 'return') {
      const description = tag.description.split('-');
      const key = description[0].trim();

      rets[key] = {
        description: description[1] ? description[1].trim() : '',
        headers: headers[key]
      };
      const type = this.parseType(tag.type);
      if (type) {
        // rets[key].type = type;
        rets[key].schema = parseSchema(tag.type);
      }
    }
  });
  // for (const i in tags) {
  //   if (tags[i].title === 'returns' || tags[i].title === 'return') {
  //     const description = tags[i].description.split('-'),
  //       key = description[0].trim();
  //
  //     rets[key] = {
  //       description: description[1] ? description[1].trim() : '',
  //       headers: headers[key]
  //     };
  //     const type = this.parseType(tags[i].type);
  //     if (type) {
  //       // rets[key].type = type;
  //       rets[key].schema = parseSchema(tags[i].type);
  //     }
  //   }
  // }
  return rets;
}

/**
 * 解析enums字段
 * @param description
 */
function parseEnums(description) {
  const enums = `${description}`.split(/-\s*eg:\s*/);
  if (enums.length < 2) {
    return [];
  }
  let currentParseType = enums[1].split(':');
  if (parseType.length === 1) {
    currentParseType = ['string', parseType[0]];
  }
  return {
    type: currentParseType[0],
    enums: currentParseType[1].split(',')
  };
}

/**
 * 过滤jsdoc
 */
function filterJsDocComments(jsDocComments) {
  return jsDocComments.filter((item) => item.tags.length > 0);
}

function parseTypedef(tags) {
  const typeName = tags[0].name;
  const details = {
    required: [],
    properties: {}
  };
  if (tags[0].type && tags[0].type.name) {
    details.allOf = [{ $ref: `#/definitions/${tags[0].type.name}` }];
  }
  for (let i = 1; i < tags.length; i += 1) {
    if (tags[i].title === 'property') {
      let currentPropName = tags[i].name;
      const propNameArr = currentPropName.split('.');

      const props = propNameArr.slice(1, propNameArr.length);
      const required = props.indexOf('required') > -1;
      const readOnly = props.indexOf('readOnly') > -1;

      if (required === true) {
        if (details.required === null) details.required = [];
        currentPropName = currentPropName.split('.')[0];
        details.required.push(currentPropName);
      }
      const schema = parseSchema(tags[i].type);

      if (schema) {
        details.properties[currentPropName] = schema;
      }
      else {
        const type = this.parseType(tags[i].type);
        const parsedDescription = (tags[i].description || '').split(
          /-\s*eg:\s*/
        );
        const description = parsedDescription[0];
        const example = parsedDescription[1];

        const prop = {
          type,
          description,
          items: parseItems(tags[i].type)
        };
        if (readOnly) {
          prop.readOnly = true;
        }
        details.properties[currentPropName] = prop;

        if (prop.type === 'enum') {
          const parsedEnum = parseEnums(`-eg:${example}`);
          prop.type = parsedEnum.type;
          prop.enum = parsedEnum.enums;
        }

        if (example) {
          switch (type) {
            case 'boolean':
              details.properties[currentPropName].example = example === 'true';
              break;
            case 'integer':
              details.properties[currentPropName].example = +example;
              break;
            case 'enum':
              break;
            default:
              details.properties[currentPropName].example = example;
              break;
          }
        }
      }
    }
  }
  return { typeName, details };
}

/**
 * js文件格式化
 * @param comments
 */
function fileFormat(comments) {
  let route;
  const parameters = {};
  const params = [];
  const tags = [];
  const definitions = {};
  for (const i in comments) {
    const desc = this.parseDescription(comments);
    if (i === 'tags') {
      if (
        comments[i].length > 0
        && comments[i][0].title
        && comments[i][0].title === 'typedef'
      ) {
        const typedefParsed = parseTypedef(comments[i]);
        definitions[typedefParsed.typeName] = typedefParsed.details;
        continue;
      }

      Object.values(comments[i]).forEach((comment) => {
        const { title } = comment;
        if (title === 'route') {
          route = parseRoute(comment.description);
          const tag = parseTag(comment);
          parameters[route.uri] = parameters[route.uri] || {};
          parameters[route.uri][route.method] = parameters[route.uri][route.method] || {};
          parameters[route.uri][route.method].parameters = [];
          parameters[route.uri][route.method].description = desc;
          parameters[route.uri][route.method].tags = [tag[0].trim()];
          tags.push({
            name: typeof tag[0] === 'string' ? tag[0].trim() : '',
            description: typeof tag[1] === 'string' ? tag[1].trim() : ''
          });
        }
        if (title === 'param') {
          const field = parseField(comment.name),
            properties = {
              name: field.name,
              in: field.parameter_type,
              description: comment.description,
              required: field.required
            },
            schema = parseSchema(comment.type);
          // we only want a type if there is no referenced schema
          if (!schema) {
            properties.type = this.parseType(comment.type);
            if (properties.type === 'enum') {
              const parsedEnum = parseEnums(comment.description);
              properties.type = parsedEnum.type;
              properties.enum = parsedEnum.enums;
            }
          }
          else properties.schema = schema;
          params.push(properties);
        }

        if (title === 'operationId' && route) {
          parameters[route.uri][route.method].operationId = comment.description;
        }

        if (title === 'summary' && route) {
          parameters[route.uri][route.method].summary = comment.description;
        }

        if (title === 'produces' && route) {
          parameters[route.uri][route.method].produces = parseProduces(
            comment.description
          );
        }

        if (title === 'consumes' && route) {
          parameters[route.uri][route.method].consumes = parseConsumes(
            comment.description
          );
        }

        if (title === 'security' && route) {
          parameters[route.uri][route.method].security = parseSecurity(
            comment.description
          );
        }

        if (title === 'deprecated' && route) {
          parameters[route.uri][route.method].deprecated = true;
        }

        if (route) {
          parameters[route.uri][route.method].parameters = params;
          parameters[route.uri][route.method].responses = parseReturn(
            comments[i]
          );
        }
      });
      // for (const j in comments[i]) {
      //   const { title } = comments[i][j];
      //   if (title === 'route') {
      //     route = parseRoute(comments[i][j].description);
      //     const tag = parseTag(comments[i]);
      //     parameters[route.uri] = parameters[route.uri] || {};
      //     parameters[route.uri][route.method] = parameters[route.uri][route.method] || {};
      //     parameters[route.uri][route.method].parameters = [];
      //     parameters[route.uri][route.method].description = desc;
      //     parameters[route.uri][route.method].tags = [tag[0].trim()];
      //     tags.push({
      //       name: typeof tag[0] === 'string' ? tag[0].trim() : '',
      //       description: typeof tag[1] === 'string' ? tag[1].trim() : ''
      //     });
      //   }
      //   if (title === 'param') {
      //     const field = parseField(comments[i][j].name),
      //       properties = {
      //         name: field.name,
      //         in: field.parameter_type,
      //         description: comments[i][j].description,
      //         required: field.required
      //       },
      //       schema = parseSchema(comments[i][j].type);
      //     // we only want a type if there is no referenced schema
      //     if (!schema) {
      //       properties.type = this.parseType(comments[i][j].type);
      //       if (properties.type === 'enum') {
      //         const parsedEnum = parseEnums(comments[i][j].description);
      //         properties.type = parsedEnum.type;
      //         properties.enum = parsedEnum.enums;
      //       }
      //     }
      //     else properties.schema = schema;
      //     params.push(properties);
      //   }
      //
      //   if (title === 'operationId' && route) {
      //     parameters[route.uri][route.method].operationId = comments[i][j].description;
      //   }
      //
      //   if (title === 'summary' && route) {
      //     parameters[route.uri][route.method].summary = comments[i][j].description;
      //   }
      //
      //   if (title === 'produces' && route) {
      //     parameters[route.uri][route.method].produces = parseProduces(
      //       comments[i][j].description
      //     );
      //   }
      //
      //   if (title === 'consumes' && route) {
      //     parameters[route.uri][route.method].consumes = parseConsumes(
      //       comments[i][j].description
      //     );
      //   }
      //
      //   if (title === 'security' && route) {
      //     parameters[route.uri][route.method].security = parseSecurity(
      //       comments[i][j].description
      //     );
      //   }
      //
      //   if (title === 'deprecated' && route) {
      //     parameters[route.uri][route.method].deprecated = true;
      //   }
      //
      //   if (route) {
      //     parameters[route.uri][route.method].parameters = params;
      //     parameters[route.uri][route.method].responses = parseReturn(
      //       comments[i]
      //     );
      //   }
      // }
    }
  }
  return { parameters, tags, definitions };
}

/**
 * Converts an array of globs to full paths
 * @function
 * @param {array} globs - Array of globs and/or normal paths
 * @return {array} Array of fully-qualified paths
 * @requires glob
 */
function convertGlobPaths(base, globs) {
  return globs.reduce((acc, globString) => {
    const globFiles = glob.sync(path.resolve(base, globString));
    return acc.concat(globFiles);
  }, []);
}

function parseApiFile(file) {
  const content = fs.readFileSync(file, 'utf-8');

  const comments = doctrineFile.parseFileContent(content, {
    unwrap: true,
    sloppy: true,
    tags: null,
    recoverable: true
  });
  return comments;
}

export default class parseSwagger {
  constructor(app) {
    this.app = app;
  }

  generateSwaggerSpec(options) {
    if (options == null) {
      throw new Error("'options' is required.");
    }
    else if (options.swaggerDefinition == null) {
      throw new Error("'swaggerDefinition' is required.");
    }
    else if (options.files == null) {
      throw new Error("'files' is required.");
    }
    else if (options.basedir == null) {
      throw new Error("'files' is required.");
    }

    // Build basic swagger json
    let swaggerObject = parseSwaggerUtil.initDefaultSwaggerInstance(
      options.swaggerDefinition
    );
    const apiFiles = convertGlobPaths(options.basedir, options.files);

    // Parse the documentation in the APIs array.
    for (let i = 0; i < apiFiles.length; i += 1) {
      const parsedFile = parseApiFile(apiFiles[i]);
      const comments = filterJsDocComments(parsedFile);

      for (const j in comments) {
        try {
          const parsed = fileFormat(comments[j]);
          parseSwaggerUtil.addDataToSwaggerObject(swaggerObject, [
            {
              paths: parsed.parameters,
              tags: parsed.tags,
              definitions: parsed.definitions
            }
          ]);
        }
        catch (e) {
          console.log(
            `Incorrect comment format. Method was not documented.\nFile: ${apiFiles[i]}\nComment:`,
            comments[j]
          );
        }
      }
    }

    swaggerParse.parse(swaggerObject, (err, api) => {
      if (!err) {
        swaggerObject = api;
      }
    });

    const url = options.route ? options.route.url : '/api-docs';
    const docs = options.route ? options.route.docs : '/api-docs.json';

    this.app.use(docs, (req, res) => {
      res.json(swaggerObject);
    });
    this.app.use(
      url,
      swaggerUIExpress({
        route: url,
        docs
      })
    );
    return swaggerObject;
  }
}
