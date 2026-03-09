const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const uploadsRoot = path.join(__dirname, '..', 'uploads');

const archiveConfigs = {
  music: {
    width: 300,
    height: 300,
    fit: 'cover',
    position: 'centre',
    quality: 82,
  },
  images: {
    width: 480,
    height: 480,
    fit: 'cover',
    position: 'centre',
    quality: 84,
  },
  projects: {
    width: 480,
    height: 270,
    fit: 'cover',
    position: 'centre',
    quality: 84,
  },
};

function getArchiveVariantFilename(filename) {
  const parsed = path.parse(filename || '');
  if (!parsed.name) return '';
  return `${parsed.name}.archive.webp`;
}

function getUploadFilePath(subdir, filename) {
  if (!filename) return '';
  return path.join(uploadsRoot, subdir, filename);
}

function getArchiveVariantPath(subdir, filename) {
  const variantFilename = getArchiveVariantFilename(filename);
  if (!variantFilename) return '';
  return getUploadFilePath(subdir, variantFilename);
}

function getPublicUploadUrl(subdir, filename) {
  return filename ? `/uploads/${subdir}/${filename}` : '';
}

function getArchiveImageUrl(subdir, filename) {
  if (!filename) return '';

  const variantPath = getArchiveVariantPath(subdir, filename);
  if (variantPath && fs.existsSync(variantPath)) {
    return getPublicUploadUrl(subdir, getArchiveVariantFilename(filename));
  }

  return getPublicUploadUrl(subdir, filename);
}

async function ensureArchiveVariant(subdir, filename) {
  const config = archiveConfigs[subdir];
  if (!config || !filename) return null;

  const sourcePath = getUploadFilePath(subdir, filename);
  const targetPath = getArchiveVariantPath(subdir, filename);

  if (!sourcePath || !targetPath) return null;
  if (!fs.existsSync(sourcePath)) return null;
  if (fs.existsSync(targetPath)) return targetPath;

  await sharp(sourcePath)
    .rotate()
    .resize({
      width: config.width,
      height: config.height,
      fit: config.fit,
      position: config.position,
      withoutEnlargement: true,
    })
    .webp({
      quality: config.quality,
      effort: 4,
    })
    .toFile(targetPath);

  return targetPath;
}

async function deleteArchiveVariant(subdir, filename) {
  const targetPath = getArchiveVariantPath(subdir, filename);
  if (!targetPath) return false;

  try {
    await fs.promises.unlink(targetPath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    console.error(`Failed to delete archive variant for ${filename}:`, err.message);
    return false;
  }
}

module.exports = {
  ensureArchiveVariant,
  deleteArchiveVariant,
  getArchiveImageUrl,
};