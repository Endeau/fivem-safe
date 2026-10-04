// What each rule reports, and how to fix it. Messages are in French: the
// people reading them run French FiveM servers.

export type RuleId = 'FX001' | 'FX002' | 'FX003' | 'FX004' | 'FX007' | 'FX101'
export type Severity = 'critical' | 'warning'
export type Confidence = 'high' | 'medium'

export interface Rule {
  id: RuleId
  severity: Severity
  title: string
  fix: string
}

export const RULES: Record<RuleId, Rule> = {
  FX001: {
    id: 'FX001',
    severity: 'critical',
    title: "Montant d'argent contrôlé par le client",
    fix:
      'Calculer le montant côté serveur (table de Config indexée par un id) ou le borner avant de payer. ' +
      "Avec safe_events : args = { { name = 'amount', type = 'integer', max = ... } }.",
  },
  FX002: {
    id: 'FX002',
    severity: 'critical',
    title: 'Item ou quantité contrôlés par le client',
    fix:
      "Vérifier le nom de l'item dans une liste du serveur et borner la quantité. " +
      "Avec safe_events : type 'string' + enum, type 'integer' + max.",
  },
  FX003: {
    id: 'FX003',
    severity: 'critical',
    title: 'Joueur cible choisi par le client, sans contrôle',
    fix:
      "Vérifier le job ou les droits de l'appelant et sa distance à la cible avant d'agir. " +
      'Avec safe_events : job = ..., distance = { ... }.',
  },
  FX004: {
    id: 'FX004',
    severity: 'critical',
    title: 'Requête SQL construite avec une valeur du client',
    fix: 'Passer les valeurs en paramètres (? ou @nom) au lieu de les concaténer dans la requête.',
  },
  FX007: {
    id: 'FX007',
    severity: 'warning',
    title: 'source lu après une attente',
    fix:
      'Copier source dans une variable locale en tête de handler (local src = source) et utiliser src ensuite. ' +
      'safe_events passe déjà le bon source au handler.',
  },
  FX101: {
    id: 'FX101',
    severity: 'critical',
    title: 'Code téléchargé puis exécuté (motif de backdoor)',
    fix:
      "Supprimer ce code et chercher d'où vient la ressource : c'est le motif des backdoors de type cipher. " +
      'Changer ensuite les mots de passe et la clé du serveur.',
  },
}

export interface Finding {
  rule: RuleId
  severity: Severity
  confidence: Confidence
  file: string
  line: number
  column: number
  message: string
  fix: string
  /** Net event or callback name, as written in the code. */
  event?: string
  /** Folder of the resource (its fxmanifest), relative to the scanned root. */
  resource?: string
}
