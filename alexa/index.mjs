// Lambda entry point for the Homestead Alexa skill. Builds the ask-sdk
// skill from the request handlers in handlers/intents.mjs and exports the
// Lambda handler the AlexaSkill event in template.yaml invokes.

import Alexa from "ask-sdk-core";
import { handlers, GenericErrorHandler } from "./handlers/intents.mjs";

export const handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(...handlers)
  .addErrorHandlers(GenericErrorHandler)
  .lambda();
