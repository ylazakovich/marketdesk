import React, { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined';
import ArrowForwardOutlinedIcon from '@mui/icons-material/ArrowForwardOutlined';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import StarBorderOutlinedIcon from '@mui/icons-material/StarBorderOutlined';

export interface UploadedProductImage {
  id: string;
  url: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number;
}

export interface ProductImageUploaderProps {
  images: string[];
  error?: string;
  disabled?: boolean;
  maxImages?: number;
  onChange: (images: string[]) => void;
  onUpload: (file: File) => Promise<UploadedProductImage>;
  onDelete?: (imageId: string) => Promise<void>;
}

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const UPLOADED_IMAGE_ID =
  /^\/uploads\/workspaces\/[0-9a-f]{24}\/products\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(?:jpg|png|webp)$/i;

export function uploadedImageId(url: string): string | null {
  return UPLOADED_IMAGE_ID.exec(url)?.[1] ?? null;
}

export function moveProductImage(images: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= images.length || to >= images.length) {
    return images;
  }
  const next = [...images];
  const [image] = next.splice(from, 1);
  next.splice(to, 0, image!);
  return next;
}

export function selectProductImageFiles(
  files: File[],
  available: number
): { selected: File[]; error?: string } {
  if (available <= 0) return { selected: [], error: 'The 12-photo limit has been reached.' };
  const selected = files.slice(0, available);
  if (selected.some((file) => !ACCEPTED_TYPES.has(file.type))) {
    return { selected: [], error: 'Only JPEG, PNG, and WebP photos are supported.' };
  }
  return files.length > available
    ? {
        selected,
        error: `Only ${available} more photo${available === 1 ? '' : 's'} can be added.`,
      }
    : { selected };
}

export const ProductImageUploader: React.FC<ProductImageUploaderProps> = ({
  images,
  error,
  disabled = false,
  maxImages = 12,
  onChange,
  onUpload,
  onDelete,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const uploadFiles = async (files: File[]) => {
    setUploadError(null);
    const available = Math.max(0, maxImages - images.length);
    const selection = selectProductImageFiles(files, available);
    setUploadError(selection.error ?? null);
    if (selection.selected.length === 0) return;

    const uploaded: string[] = [];
    for (const file of selection.selected) {
      setUploading((current) => [...current, file.name]);
      try {
        const image = await onUpload(file);
        uploaded.push(image.url);
      } catch (caught) {
        const failure = caught as { data?: { error?: { message?: string } }; message?: string };
        setUploadError(
          failure.data?.error?.message ?? failure.message ?? `Could not upload ${file.name}.`
        );
      } finally {
        setUploading((current) => current.filter((name) => name !== file.name));
      }
    }
    if (uploaded.length > 0) onChange([...images, ...uploaded]);
    if (inputRef.current) inputRef.current.value = '';
  };

  const remove = async (index: number) => {
    const url = images[index]!;
    const imageId = uploadedImageId(url);
    try {
      if (imageId && onDelete) await onDelete(imageId);
      onChange(images.filter((_image, current) => current !== index));
    } catch (caught) {
      const failure = caught as { data?: { error?: { message?: string } }; message?: string };
      setUploadError(failure.data?.error?.message ?? failure.message ?? 'Could not remove the photo.');
    }
  };

  return (
    <Stack spacing={2}>
      <Box
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Upload product photos"
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) void uploadFiles(Array.from(event.dataTransfer.files));
        }}
        sx={{
          p: 3,
          textAlign: 'center',
          border: '2px dashed',
          borderColor: error ? 'error.main' : dragging ? 'primary.main' : 'divider',
          borderRadius: 2,
          bgcolor: dragging ? 'action.hover' : 'background.paper',
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        <input
          ref={inputRef}
          hidden
          multiple
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled || images.length >= maxImages}
          onChange={(event) => void uploadFiles(Array.from(event.target.files ?? []))}
        />
        <AddPhotoAlternateOutlinedIcon color="primary" sx={{ fontSize: 36 }} />
        <Typography variant="subtitle2">Drop photos here or choose files</Typography>
        <Typography variant="caption" color="text.secondary">
          JPEG, PNG or WebP · up to {maxImages} photos · first photo is the cover
        </Typography>
      </Box>

      {(error || uploadError) && <Alert severity="error">{uploadError ?? error}</Alert>}
      {uploading.length > 0 && (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={18} />
          <Typography variant="body2">Uploading {uploading.join(', ')}</Typography>
        </Stack>
      )}

      {images.length > 0 && (
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
          {images.map((image, index) => (
            <Stack
              key={`${image}-${index}`}
              spacing={0.5}
              sx={{ width: 132, p: 1, border: 1, borderColor: 'divider', borderRadius: 2 }}
            >
              <Box sx={{ position: 'relative' }}>
                <Box
                  component="img"
                  src={image}
                  alt={`Product photo ${index + 1}`}
                  sx={{ width: 114, height: 96, borderRadius: 1, objectFit: 'cover' }}
                />
                {index === 0 && (
                  <Chip size="small" label="Cover" sx={{ position: 'absolute', left: 4, top: 4 }} />
                )}
              </Box>
              <Stack direction="row" justifyContent="center">
                {index > 0 && (
                  <IconButton
                    size="small"
                    aria-label={`Set photo ${index + 1} as cover`}
                    onClick={() => onChange(moveProductImage(images, index, 0))}
                    disabled={disabled}
                  >
                    <StarBorderOutlinedIcon fontSize="small" />
                  </IconButton>
                )}
                <IconButton
                  size="small"
                  aria-label={`Move photo ${index + 1} left`}
                  onClick={() => onChange(moveProductImage(images, index, index - 1))}
                  disabled={disabled || index === 0}
                >
                  <ArrowBackOutlinedIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label={`Move photo ${index + 1} right`}
                  onClick={() => onChange(moveProductImage(images, index, index + 1))}
                  disabled={disabled || index === images.length - 1}
                >
                  <ArrowForwardOutlinedIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  color="error"
                  aria-label={`Remove photo ${index + 1}`}
                  onClick={() => void remove(index)}
                  disabled={disabled}
                >
                  <DeleteOutlinedIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Stack>
          ))}
        </Stack>
      )}

      <Button
        variant="outlined"
        startIcon={<AddPhotoAlternateOutlinedIcon />}
        onClick={() => inputRef.current?.click()}
        disabled={disabled || images.length >= maxImages}
        sx={{ alignSelf: 'flex-start' }}
      >
        Add photos ({images.length}/{maxImages})
      </Button>
    </Stack>
  );
};
