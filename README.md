# Transcription Audio

Application web qui transcrit des enregistrements audio en texte, via **Whisper
large v3 sur Groq**. Interface en français, installable comme application (PWA).

## Le point important : tout se passe dans le navigateur

Il n'y a **aucun backend**. Pas de route API, pas de serveur qui reçoit vos fichiers.

- L'audio n'est **jamais** envoyé à un serveur de ce projet — il part directement
  du navigateur vers `api.groq.com`.
- La clé API est **celle de l'utilisateur**, saisie dans l'interface et gardée en
  `sessionStorage` : elle disparaît à la fermeture de l'onglet, n'est jamais
  committée, et ne transite par aucun serveur intermédiaire.
- Conséquence : le déploiement est purement statique, et il n'y a pas de variable
  d'environnement à configurer.

Chaque utilisateur crée sa clé gratuite sur <https://console.groq.com/keys>.

## Découpage des fichiers volumineux

Groq plafonne à ~25 Mo par requête. L'application découpe donc l'audio en morceaux
de **20 Mo** (`CHUNK_SIZE_MB`), les décode en WAV, les transcrit un par un, puis
recolle le texte. C'est ce qui permet de traiter un enregistrement long sans le
préparer à la main.

## Lancer en local

```bash
npm install
npm run dev
```

Puis <http://localhost:3000>.

```bash
npm run build && npm start   # version de production
npm run lint                 # ESLint
```

## Structure

```
app/page.tsx                    point d'entrée (5 lignes, monte le composant)
components/TranscriptionApp.tsx  toute l'application (~800 lignes)
public/manifest.json            configuration PWA
```

L'application tient dans **un seul composant client**. C'est volontaire et suffisant
à cette taille, mais c'est aussi le premier endroit à découper si le projet grossit :
l'appel à Groq, le découpage audio et l'interface y cohabitent.

Next.js 14 · React 18 · Tailwind CSS · TypeScript

## À savoir avant de reprendre le projet

- `public/manifest.json` déclare `/icon-192.png` et `/icon-512.png`, **qui ne sont
  pas dans le dépôt**. L'installation en PWA fonctionnera sans icône propre tant
  que ces deux fichiers n'auront pas été ajoutés.
- Le projet est en Next.js 14 et React 18, plus anciens que les autres projets du
  compte. Une montée de version est à prévoir avant d'ajouter des fonctionnalités.
