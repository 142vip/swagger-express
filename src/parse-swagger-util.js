/**
 * Checks if tag is already contained withing target.
 * The tag is an object of type http://swagger.io/specification/#tagObject
 * The target, is the part of the swagger specification that holds all tags.
 * @function
 * @param {object} target - Swagger object place to include the tags data.
 * @param {object} tag - Swagger tag object to be included.
 * @returns {boolean} Does tag is already present in target
 */
import RecursiveIterator from 'recursive-iterator';

function isExistTag(target, tag) {
  // Check input is workable.
  if (target && target.length && tag) {
    for (let i = 0; i < target.length; i += 1) {
      const targetTag = target[i];
      // The name of the tag to include already exists in the taget.
      // Therefore, it's not necessary to be added again.
      if (targetTag.name === tag.name) {
        return true;
      }
    }
  }

  // This will indicate that `tag` is not present in `target`.
  return false;
}

/**
 * Adds the tags property to a swagger object.
 * @function
 * @param {object} conf - Flexible configuration.
 */
function attachTagsProperty(conf) {
  const { tag } = conf;
  const { swaggerObject } = conf;
  let { propertyName } = conf;

  // Correct deprecated property.
  if (propertyName === 'tag') {
    propertyName = 'tags';
  }

  if (Array.isArray(tag)) {
    for (let i = 0; i < tag.length; i += 1) {
      if (!isExistTag(swaggerObject[propertyName], tag[i])) {
        swaggerObject[propertyName].push(tag[i]);
      }
    }
  }
  else if (!isExistTag(swaggerObject[propertyName], tag)) {
    swaggerObject[propertyName].push(tag);
  }
}

/**
 * Adds necessary swagger schema object properties.
 * @see https://goo.gl/Eoagtl
 * @function
 * @param {object} swaggerObject - The object to receive properties.
 * @returns {object} swaggerObject - The updated object.
 */
function initDefaultSwaggerInstance(swaggerObject) {
  const defaultSwaggerInstance = {};
  defaultSwaggerInstance.swagger = '2.0';
  defaultSwaggerInstance.paths = swaggerObject.paths || {};
  defaultSwaggerInstance.responses = swaggerObject.responses || {};
  defaultSwaggerInstance.parameters = swaggerObject.parameters || {};
  defaultSwaggerInstance.securityDefinitions = swaggerObject.securityDefinitions || {};
  defaultSwaggerInstance.tags = swaggerObject.tags || [];
  return defaultSwaggerInstance;
}

/**
 * List of deprecated or wrong swagger schema properties in singular.
 * @function
 * @returns {array} The list of deprecated property names.
 */
const swaggerSchemaWrongProperties = [
  'consume',
  'produce',
  'path',
  'tag',
  'definition',
  'securityDefinition',
  'scheme',
  'response',
  'parameter',
  'deprecated'
];

/**
 * Makes a deprecated property plural if necessary.
 * @function
 * @param {string} propertyName - The swagger property name to check.
 * @returns {string} The updated propertyName if necessary.
 */
function resetSwaggerKey(propertyName) {
  if (swaggerSchemaWrongProperties.indexOf(propertyName) > 0) {
    // Returns the corrected property name.
    return `${propertyName}s`;
  }
  return propertyName;
}

/**
 * Handles swagger propertyName in pathObject context for swaggerObject.
 * @function
 * @param {object} swaggerObject - The swagger object to update.
 * @param {object} pathObject - The input context of an item for swaggerObject.
 * @param {string} propertyName - The property to handle.
 */
function handleSwaggerProperties(swaggerObject, pathObject, propertyName) {
  const swaggerInstance = {};
  const simpleProperties = [
    'consume',
    'consumes',
    'produce',
    'produces',
    // 'path',
    // 'paths',
    'schema',
    'schemas',
    'securityDefinition',
    'securityDefinitions',
    'response',
    'responses',
    'parameter',
    'parameters',
    'definition',
    'definitions'
  ];

  // Common properties.
  if (simpleProperties.indexOf(propertyName) !== -1) {
    const keyName = resetSwaggerKey(propertyName);
    const definitionNames = Object.getOwnPropertyNames(
      pathObject[propertyName]
    );
    for (let k = 0; k < definitionNames.length; k += 1) {
      const definitionName = definitionNames[k];
      swaggerInstance[keyName][definitionName] = pathObject[propertyName][definitionName];
    }
    // Tags.
  }
  else if (propertyName === 'tag' || propertyName === 'tags') {
    const tag = pathObject[propertyName];
    attachTagsProperty({
      tag,
      swaggerObject,
      propertyName
    });
    // Paths.
  }
  else {
    const routes = Object.getOwnPropertyNames(pathObject[propertyName]);

    for (let k = 0; k < routes.length; k += 1) {
      const route = routes[k];
      if (!swaggerObject.paths) {
        swaggerInstance.paths = {};
      }
      swaggerInstance.paths[route] = {
        ...swaggerObject.paths[route],
        ...pathObject[propertyName][route]
      };
    }
  }
}

/**
 * Adds the data in to the swagger object.
 * @function
 * @param {object} swaggerObject - Swagger object which will be written to
 * @param {object[]} data - objects of parsed swagger data from yml or jsDoc
 *                          comments
 */
function addDataToSwaggerObject(swaggerObject, data) {
  if (!swaggerObject || !data) {
    throw new Error('swaggerObject and data are required!');
  }

  for (let i = 0; i < data.length; i += 1) {
    const pathObject = data[i];
    const propertyNames = Object.getOwnPropertyNames(pathObject);
    // Iterating the properties of the a given pathObject.
    for (let j = 0; j < propertyNames.length; j += 1) {
      const propertyName = propertyNames[j];
      // Do what's necessary to organize the end specification.
      handleSwaggerProperties(swaggerObject, pathObject, propertyName);
    }
  }
}

/**
 * Aggregates a list of wrong properties in problems.
 * Searches in object based on a list of wrongSet.
 * @param {Array|object} list - a list to iterate
 * @param {Array} wrongSet - a list of wrong properties
 * @param {Array} problems - aggregate list of found problems
 */
function seekWrong(list, wrongSet, problems) {
  const iterator = new RecursiveIterator(list, 0, false);
  for (let item = iterator.next(); !item.done; item = iterator.next()) {
    const isDirectChildOfProperties = item.value.path[item.value.path.length - 2] === 'properties';

    if (wrongSet.indexOf(item.value.key) > 0 && !isDirectChildOfProperties) {
      problems.push(item.value.key);
    }
  }
}

/**
 * Returns a list of problematic tags if any.
 * @function
 * @param {Array} sources - a list of objects to iterate and check
 * @returns {Array} problems - a list of problems encountered
 */
function findDeprecated(sources) {
  const problems = [];
  sources.forEach((source) => {
    // Iterate through `source`, search for `wrong`, accumulate in `problems`.
    seekWrong(source, swaggerSchemaWrongProperties, problems);
  });
  return problems;
}

export default {
  addDataToSwaggerObject,
  initDefaultSwaggerInstance,
  findDeprecated
};
