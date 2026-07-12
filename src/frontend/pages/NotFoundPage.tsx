// STUB — real implementation is Group 9.
import React from 'react';
import { Button, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();
  return (
    <Stack spacing={2} alignItems="flex-start" sx={{ py: 6 }}>
      <Typography variant="h1" sx={{ fontSize: '3rem' }}>
        404
      </Typography>
      <Typography variant="body1" color="text.secondary">
        The page you are looking for does not exist.
      </Typography>
      <Button variant="contained" onClick={() => navigate('/')}>
        Back to dashboard
      </Button>
    </Stack>
  );
};

export default NotFoundPage;
