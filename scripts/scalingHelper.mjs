const moduleId = 'pfs-3-99-fate-in-the-future';

export async function scalingHelper() {
  // select the scenario and get the full scaling data object
  const scenarioData = await getScenarioData();
  if (!scenarioData) {
    ui.notifications.info('Scaling cancelled.');
    return;
  }

  // get info on the party the scenario needs to be scaled for
  const scalingOptions = await getScalingOptions();
  if (!scalingOptions) {
    ui.notifications.info('Scaling cancelled.');
    return;
  }

  // build the scenes with the scaling data
  scaleScenario(scenarioData, scalingOptions);
}

async function getScenarioData() {
  return await fetch('./modules/pfs-3-99-fate-in-the-future/scripts/3-99.json')
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      return response.json();
    })
    .catch((error) => console.error('Failed to fetch data:', error));
}

function getScalingOptionsFromSelection() {
  // get party from selected tokens
  const { minX, minY } = canvas.tokens.controlled.reduce(
    (acc, t) => {
      const x = t.document.x;
      const y = t.document.y;
      return {
        minX: Math.min(acc.minX, x),
        minY: Math.min(acc.minY, y),
      };
    },
    { minX: Infinity, minY: Infinity }
  );
  const gridSize = canvas.dimensions.size;
  const selected = canvas.tokens.controlled.map((t) => {
    const actor = t.document.actor;
    const level = actor.system.details.level.value;
    return {
      level,
      hasPlayerOwner: t.document.hasPlayerOwner,
      pc: actor.class?._stats?.compendiumSource?.startsWith('Compendium.pf2e.classes'),
      actor,
      x: Math.round(t.document.x - minX / gridSize),
      y: Math.round(t.document.y - minY / gridSize),
    };
  });

  // filter out NPCs for copying between scenes, it's irritating when it happens
  // if no tokens are selected, try getting the active party
  const party =
    selected.filter((s) => s.hasPlayerOwner).length > 0
      ? selected.filter((s) => s.hasPlayerOwner)
      : game.actors.party.members.map((a, i) => ({
          level: a.system.details.level.value,
          hasPlayerOwner: a.hasPlayerOwner,
          pc: a.class?._stats?.compendiumSource?.startsWith('Compendium.pf2e.classes'),
          actor: a,
          x: i % 3,
          y: Math.floor(i / 3),
        }));

  if (!party.length) {
    ui.notifications.info('No tokens selected and no active party found.');
    return;
  }
  // filter out Companions for calculating CP
  const pcs = party.filter((s) => s.pc);

  // check level range
  const levelRange = pcs.reduce((acc, s) => {
    const rangeBracket = Math.floor((s.level - 1) / 4) + 1;
    return acc === 0 ? rangeBracket : acc === rangeBracket ? acc : -1;
  }, 0);
  if (!(-1 < levelRange < 3)) {
    ui.notifications.error('invalid party level range');
    return;
  }

  const cp = pcs.reduce((acc, s) => {
    const level = s.level;
    const cp = ((level - 1) % 4) + 2;
    return cp === 5 ? acc + 6 : acc + cp;
  }, 0);
  const tier = levelRange == 1 ? '1-4' : '5-8';
  return {
    party,
    cp,
    tier,
  };
}

async function getScalingOptions() {
  const { DialogV2 } = foundry.applications.api;
  const { StringField, NumberField } = foundry.data.fields;

  const partyInfo = getScalingOptionsFromSelection();

  const content =
    new NumberField({
      label: 'CP:',
      min: 8,
      max: 36,
      step: 1,
      initial: partyInfo?.cp ?? 8,
      hint: 'automatically calculated from selected tokens',
    }).toFormGroup({}, { name: 'cp', autofocus: true }).outerHTML +
    new NumberField({
      label: 'Party Size:',
      min: 4,
      max: 6,
      step: 1,
      initial: partyInfo?.party.length ?? 4,
      hint: 'automatically calculated from selected tokens',
    }).toFormGroup({}, { name: 'pcs' }).outerHTML +
    new StringField({
      label: 'Level Range:',
      initial: partyInfo?.tier ?? '1-4',
      choices: {
        '1-4': '1-4',
        '5-8': '5-8',
      },
      nullable: false,
      hint: 'automatically calculated from selected tokens',
    }).toFormGroup({}, { name: 'tier' }).outerHTML;

  const scenarioData = await DialogV2.wait({
    window: { title: 'Scaling Selection' },
    content,
    buttons: [
      {
        label: 'Continue',
        action: 'apply-scaling',
        callback: (_event, button) => new FormDataExtended(button.form).object,
      },
      {
        label: 'Cancel',
        action: 'cancel',
        callback: () => null,
      },
    ],
    rejectClose: false,
    default: 'apply-scaling',
  });
  if (!scenarioData.cp || !scenarioData.pcs || !scenarioData.tier) {
    ui.notifications.error('Invalid scaling options');
    return null;
  }
  scenarioData.party = partyInfo.party;
  return scenarioData;
}

function testScaling(predicate, scalingOptions) {
  for (const [key, value] of Object.entries(predicate)) {
    if (!value.includes(scalingOptions[key])) {
      return false;
    }
  }
  return true;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function readScalingData(name, tokens, scaling) {
  if (scaling[name] == undefined) {
    return;
  }
  // apply scaling
  let scaledTokens = tokens.slice(0);

  if (scaling[name].randomizeOrder) {
    shuffleArray(scaledTokens);
  }
  if (scaling[name].amount) {
    scaledTokens = scaledTokens.slice(0, scaling[name].amount);
  }
  if (scaling[name].adjustments) {
    for (let i = 0; i > scaling[name].adjustments.length && i < scaledTokens.length; i++) {
      foundry.utils.mergeObject(scaledTokens[i], { [`flags.${moduleId}`]: scaling[name].adjustments[i] });
    }
  }
  if (scaling[name].adjustAll) {
    for (let i = 0; i < scaledTokens.length; i++) {
      foundry.utils.mergeObject(scaledTokens[i], { [`flags.${moduleId}`]: scaling[name].adjustAll });
    }
  }
  return scaledTokens;
}

async function scaleJournal(scalingOptions) {
  const subtier =
    scalingOptions.tier === '1-4'
      ? scalingOptions.cp < 16
        ? '1-2'
        : scalingOptions.cp < 19 && scalingOptions.pcs == 4
        ? '1-2'
        : '3-4'
      : scalingOptions.cp < 16
      ? '5-6'
      : scalingOptions.cp < 19 && scalingOptions.pcs == 4
      ? '5-6'
      : '7-8';
  // Add flags to journals to facilitate hiding unnecessary sections with CSS
  const additionalCssClass = [
    `journal-tier-${subtier}`,
    `journal-party-${scalingOptions.pcs == 4 ? 'four' : scalingOptions.pcs == 5 ? 'five' : 'six'}`,
  ].join(' ');
  // update all journals because it's easier
  await game.journal.updateAll({
    [`flags.${moduleId}.tier`]: additionalCssClass,
  });
}

async function scaleScenario(scenarioData, scalingOptions) {
  scaleJournal(scalingOptions);

  // Clear all Combats, GMs always forget that
  Combat.deleteDocuments([], { deleteAll: true });

  const sceneData = {};
  for (const encounter of scenarioData.encounters) {
    // add players to our array of tokens
    const partyData = [];
    const newSceneDPI = game.scenes.get(encounter.scene).dimensions.size;
    if (scalingOptions.party && encounter.pcStart) {
      for (const tokenInfo of scalingOptions.party) {
        partyData[tokenInfo.actor.id] = [
          {
            x: tokenInfo.x * newSceneDPI + encounter.pcStart.x,
            y: tokenInfo.y * newSceneDPI + encounter.pcStart.y,
            elevation: encounter.pcStart.elevation ?? 0,
            hidden: false,
          },
        ];
      }
    }
    sceneData[encounter.scene] = foundry.utils.mergeObject(sceneData[encounter.scene] ?? {}, partyData);

    const scaling = encounter.scaling.find((s) => testScaling(s.predicate, scalingOptions));
    if (!scaling) {
      continue;
    }

    const tokenData = [];
    for (const [name, tokens] of Object.entries(encounter.tokenSet)) {
      const actor = game.actors.get(encounter.actors[name]);
      if (!actor) {
        ui.notifications.error(`Actor ${name} not found`);
        continue;
      }
      const scaledTokens = readScalingData(name, tokens, scaling);
      if (scaledTokens) {
        tokenData[encounter.actors[name]] = scaledTokens;
      }
    }
    sceneData[encounter.scene] = foundry.utils.mergeObject(sceneData[encounter.scene] ?? {}, tokenData);
  }
  for (const [sceneId, data] of Object.entries(sceneData)) {
    const scene = game.scenes.get(sceneId);
    if (!scene) {
      continue;
    }

    scene.deleteEmbeddedDocuments('Token', [], { deleteAll: true });

    const tokenData = [];
    for (const [actorId, documentDatas] of Object.entries(data)) {
      const actor = game.actors.get(actorId);
      if (!actor) {
        continue;
      }
      for (const documentData of documentDatas) {
        tokenData.push(await actor.getTokenDocument(documentData));
      }
    }

    // if no player tokens were selected, and the scene does not have any scaling defined,
    // we might not have anything to place
    if (tokenData) {
      await scene.createEmbeddedDocuments('Token', tokenData);
      for (const token of scene.tokens) {
        if (token.flags?.['pfs-3-99-fate-in-the-future']?.conditions) {
          for (const condition of token.flags?.['pfs-3-99-fate-in-the-future']?.conditions) {
            await token.actor.toggleCondition(condition);
          }
        }
        if (token.flags?.['pfs-3-99-fate-in-the-future']?.adjustments) {
          if (token.flags?.['pfs-3-99-fate-in-the-future']?.adjustments.includes('elite')) {
            await token.actor.applyAdjustment('elite');
          }
          if (token.flags?.['pfs-3-99-fate-in-the-future']?.adjustments.includes('weak')) {
            await token.actor.applyAdjustment('weak');
          }
        }
        if (token.flags?.['pfs-3-99-fate-in-the-future']?.items) {
          const items = [];
          for (const item of token.flags?.['pfs-3-99-fate-in-the-future']?.items) {
            items.push(await fromUuid(item));
          }
          await token.actor.createEmbeddedDocuments('Item', items);
        }
        if (token.flags?.['pfs-3-99-fate-in-the-future']?.hp) {
          if (/^[+-]/.test(token.flags['pfs-3-99-fate-in-the-future'].hp)) {
            await token.actor.update(
              {
                'system.attributes.hp.max':
                  token.actor.system.attributes.hp.max + Number(token.flags['pfs-3-99-fate-in-the-future'].hp),
                'system.attributes.hp.value':
                  token.actor.system.attributes.hp.value + Number(token.flags['pfs-3-99-fate-in-the-future'].hp),
              },
              { allowHPOverage: true }
            );
          }
        }
      }
    }
  }
}
